const mongoose = require('mongoose');
const connectDB = require('../config/database');
const { markHealthy } = require('../helpers/HealthState');

async function ensureDbMiddleware(req, res, next) {
  if (mongoose.connection.readyState === 1) return next();
  try {
    await connectDB();
    markHealthy('database');
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = ensureDbMiddleware;
