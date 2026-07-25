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

const { getSettingsLean, publicSettings } = require('../services/SettingsService');
const { getUserCapabilities } = require('../helpers/PermissionHelper');
const { escapeHtml } = require('../helpers/ClientErrorHelper'); // We can just use a simple escape

function safeJsonForHtml(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

async function spaMiddleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.originalUrl.startsWith('/api/')) return next();
  if (!SPA_ROUTE_RE.test(req.path)) return next();
  if (req.accepts(['html', 'json']) !== 'html') return next();
  if (!spaIndexExists()) return next();

  try {
    const rawHtml = fs.readFileSync(SPA_INDEX, 'utf-8');
    const settings = await getSettingsLean();
    const caps = await getUserCapabilities();
    
    const orgName = settings.organizationName || 'سامانه تغذیه';
    const pubSettings = publicSettings(settings);

    const bootstrapData = {
      settings: pubSettings,
      capabilities: caps,
    };

    const injectedHtml = rawHtml
      .replace(/<title>.*?<\/title>/, `<title>${orgName}</title>`)
      .replace(
        '</head>',
        `<script id="app-bootstrap-data" type="application/json">${safeJsonForHtml(bootstrapData)}</script></head>`
      );

    res.set('Content-Type', 'text/html');
    return res.send(injectedHtml);
  } catch (err) {
    return res.sendFile(SPA_INDEX);
  }
}

module.exports = spaMiddleware;
