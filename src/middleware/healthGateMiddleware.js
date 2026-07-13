const mongoose = require('mongoose');
const { isHealthy, markHealthy } = require('../helpers/HealthState');
const {
  isSuperadminSession,
  isPublicUnavailableAsset,
  renderUnavailable,
} = require('../helpers/UnavailableHelper');

function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

function healthGateMiddleware(req, res, next) {
  if (!isHealthy() && isDatabaseReady()) {
    markHealthy('database');
  }
  if (isHealthy()) return next();
  if (isSuperadminSession(req)) return next();
  if (isPublicUnavailableAsset(req)) return next();
  if (process.env.ALLOW_SYSTEM_TEST === 'true' && req.path === '/api/system/test-disconnect-db') return next();
  if (req.path === '/api/system/health') return next();
  return renderUnavailable(req, res, 503);
}

module.exports = healthGateMiddleware;
