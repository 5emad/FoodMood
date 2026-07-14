const mongoose = require('mongoose');
const { recordLifecycleEvent } = require('../services/SystemLogService');
const { markHealthy, markUnhealthy } = require('../helpers/HealthState');
const {
  msgDbConnected,
  msgDbReconnected,
  msgDbDisconnected,
  msgDbError,
} = require('../helpers/SystemLogCatalog');

let listenersAttached = false;

function attachConnectionListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on('connected', () => {
    markHealthy('database');
    recordLifecycleEvent('db_connect', msgDbConnected(), {
      level: 'info',
      category: 'database',
      code: 'DB_CONNECTED',
    });
  });

  mongoose.connection.on('disconnected', () => {
    recordLifecycleEvent('db_disconnect', msgDbDisconnected(), {
      level: 'error',
      category: 'database',
      code: 'DB_DISCONNECTED',
    });
    markUnhealthy('database', msgDbDisconnected());
  });

  mongoose.connection.on('error', (error) => {
    recordLifecycleEvent('db_disconnect', msgDbError(error.message), {
      level: 'error',
      category: 'database',
      code: 'DB_ERROR',
      stack: error.stack,
      detail: error.message,
    });
    markUnhealthy('database', error.message);
  });

  mongoose.connection.on('reconnected', () => {
    markHealthy('database');
    recordLifecycleEvent('db_connect', msgDbReconnected(), {
      level: 'info',
      category: 'database',
      code: 'DB_RECONNECTED',
    });
  });
}

const connectDB = async () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const mongoUri = process.env.MONGODB_URI || (!isProduction ? 'mongodb://localhost:27017/food_ordering' : '');

  if (!mongoUri) {
    throw new Error('MONGODB_URI is required in production');
  }

  const usesSrv = mongoUri.startsWith('mongodb+srv://');
  const useTls = process.env.MONGODB_TLS === 'true' || usesSrv;
  const isLocalMongo = /mongodb(?:\+srv)?:\/\/(?:[^/@]*@)?(?:127\.0\.0\.1|localhost)(?::|\/)/.test(mongoUri);
  if (isProduction && !useTls && !isLocalMongo) {
    throw new Error('MongoDB TLS must be enabled in production');
  }

  const requiresPassword = process.env.MONGODB_AUTH_MECHANISM !== 'MONGODB-X509';
  const hasCredentials = /^mongodb(?:\+srv)?:\/\/[^/@:]+:[^/@]+@/.test(mongoUri);
  if (isProduction && requiresPassword && !hasCredentials) {
    throw new Error('MongoDB credentials are required in production');
  }

  const options = {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 8000),
    connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 10000),
    socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS || 45000),
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 10),
    minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE || 0),
    autoIndex: !isProduction,
    bufferCommands: false,
    retryReads: true,
    retryWrites: true,
  };

  if (useTls) {
    options.tls = true;
    if (process.env.MONGODB_TLS_CA_FILE) options.tlsCAFile = process.env.MONGODB_TLS_CA_FILE;
    if (process.env.MONGODB_TLS_CERT_KEY_FILE) options.tlsCertificateKeyFile = process.env.MONGODB_TLS_CERT_KEY_FILE;
    options.tlsAllowInvalidCertificates = false;
    options.tlsAllowInvalidHostnames = false;
  }

  mongoose.set('strictQuery', true);
  attachConnectionListeners();

  const state = mongoose.connection.readyState;
  if (state === 1) return;
  if (state !== 0) {
    await mongoose.disconnect().catch(() => {});
  }

  await mongoose.connect(mongoUri, options);
  markHealthy('database');
  console.log('MongoDB connected');
};

module.exports = connectDB;
