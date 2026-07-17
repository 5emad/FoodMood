const mongoose = require('mongoose');
const connectDB = require('../config/database');
const { markHealthy } = require('../helpers/HealthState');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (mongoose.connection.readyState === 1) return true;
    await sleep(100);
  }
  return mongoose.connection.readyState === 1;
}

async function ensureDbMiddleware(req, res, next) {
  if (mongoose.connection.readyState === 1) return next();

  try {
    // Connecting/disconnecting: wait briefly instead of force-disconnect (avoids false outages).
    if (mongoose.connection.readyState === 2 || mongoose.connection.readyState === 3) {
      const ready = await waitForReady(4000);
      if (ready) {
        markHealthy('database');
        return next();
      }
    }

    await connectDB();
    markHealthy('database');
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = ensureDbMiddleware;
