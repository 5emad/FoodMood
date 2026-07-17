const path = require('path');
const fs = require('fs');

const SPA_INDEX = path.join(__dirname, '../../public/spa/index.html');

const SPA_ROUTE_RE = /^\/(?:login|complete-profile|foods|user(?:\/|$)|admin(?:\/|$))(?:.*)?$/;

function spaIndexExists() {
  try {
    return fs.existsSync(SPA_INDEX);
  } catch {
    return false;
  }
}

function spaMiddleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.originalUrl.startsWith('/api/')) return next();
  if (!SPA_ROUTE_RE.test(req.path)) return next();
  if (req.accepts(['html', 'json']) !== 'html') return next();
  if (!spaIndexExists()) return next();
  return res.sendFile(SPA_INDEX);
}

module.exports = spaMiddleware;
