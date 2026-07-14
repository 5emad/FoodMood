const mongoose = require('mongoose');
const connectDB = require('../config/database');
const { markHealthy } = require('../helpers/HealthState');

async function ensureDbMiddleware(req, res, next) {
  const state = mongoose.connection.readyState;
  if (state === 1) return next();
  try {
    if (state !== 0) {
      await mongoose.disconnect().catch(() => {});
    }
    await connectDB();
    markHealthy('database');
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = ensureDbMiddleware;
