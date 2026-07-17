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

function requestPath(req) {
  const raw = req.originalUrl || req.url || req.path || '';
  return String(raw).split('?')[0];
}

function isAdminPath(req) {
  const p = requestPath(req);
  return p.startsWith('/admin') || p.startsWith('/api/admin');
}

function isAuthPath(req) {
  const p = requestPath(req);
  return p.startsWith('/api/auth') || p === '/login' || p.startsWith('/login/') || p === '/';
}

function healthGateMiddleware(req, res, next) {
  // Public outage page only — admin/login always pass through first.
  if (isAdminPath(req) || isAuthPath(req)) return next();
  if (isSuperadminSession(req)) return next();
  if (isPublicUnavailableAsset(req)) return next();
  if (process.env.ALLOW_SYSTEM_TEST === 'true' && req.path === '/api/system/test-disconnect-db') return next();
  if (req.path === '/api/system/health') return next();

  if (!isHealthy() && isDatabaseReady()) {
    markHealthy('database');
  }
  if (isHealthy()) return next();
  return renderUnavailable(req, res, 503);
}

module.exports = healthGateMiddleware;
