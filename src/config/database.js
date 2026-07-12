const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const isProduction = process.env.NODE_ENV === 'production';
    const mongoUri = process.env.MONGODB_URI || (!isProduction ? 'mongodb://localhost:27017/food_ordering' : '');

    if (!mongoUri) {
      throw new Error('MONGODB_URI is required in production');
    }

    const usesSrv = mongoUri.startsWith('mongodb+srv://');
    const useTls = process.env.MONGODB_TLS === 'true' || usesSrv;
    if (isProduction && !useTls) {
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
    // NOTE: global sanitizeFilter is intentionally NOT enabled: it wraps every
    // server-side operator filter ({ $ne }, { $gt }, { $in }, ...) in $eq and
    // crashes bootstrap (ensureCurrentWeek). User input is already sanitized by
    // the mongoSanitize middleware before it can reach a query.
    await mongoose.connect(mongoUri, options);

    mongoose.connection.on('error', (error) => {
      console.error('MongoDB connection error:', error.message);
    });
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    throw error;
  }
};

module.exports = connectDB;
