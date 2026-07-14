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

function isAdminPath(req) {
  const path = req.path || '';
  const url = req.originalUrl || '';
  return path.startsWith('/admin')
    || url.startsWith('/api/admin')
    || path.startsWith('/api/admin');
}

function isAuthPath(req) {
  const path = req.path || '';
  return path.startsWith('/api/auth') || path === '/login';
}

function healthGateMiddleware(req, res, next) {
  if (!isHealthy() && isDatabaseReady()) {
    markHealthy('database');
  }
  if (isHealthy()) return next();
  // Admin/superadmin panels and login must never show the public outage page.
  if (isAdminPath(req) || isAuthPath(req)) return next();
  if (isSuperadminSession(req)) return next();
  if (isPublicUnavailableAsset(req)) return next();
  if (process.env.ALLOW_SYSTEM_TEST === 'true' && req.path === '/api/system/test-disconnect-db') return next();
  if (req.path === '/api/system/health') return next();
  return renderUnavailable(req, res, 503);
}

module.exports = healthGateMiddleware;
