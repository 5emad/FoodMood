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

const { getSettingsLean, publicSettings, defaultSettings } = require('../services/SettingsService');
const { getUserCapabilities } = require('../helpers/PermissionHelper');
const { getVersionViewModel, setDbVersionOverride } = require('../helpers/AppVersionHelper');

function safeJsonForHtml(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function injectSpaHtml(rawHtml, bootstrapData, orgName) {
  const version = bootstrapData.version || getVersionViewModel();
  return rawHtml
    .replace(/<title>.*?<\/title>/, `<title>${orgName}</title>`)
    .replace(
      '</head>',
      `<meta name="foodmood-version" content="${version.appVersion || ''}" />`
      + `<script id="app-bootstrap-data" type="application/json">${safeJsonForHtml(bootstrapData)}</script>`
      + '</head>'
    )
    .replace(
      '<div id="root"></div>',
      `<div id="root"></div><noscript><div style="text-align:center;padding:1rem;font-family:Tahoma,sans-serif;direction:rtl">نسخه ${version.appVersionFa || version.appVersion || ''}</div></noscript>`
    );
}

async function spaMiddleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.originalUrl.startsWith('/api/')) return next();
  if (!SPA_ROUTE_RE.test(req.path)) return next();
  if (req.accepts(['html', 'json']) !== 'html') return next();
  if (!spaIndexExists()) return next();

  try {
    const rawHtml = fs.readFileSync(SPA_INDEX, 'utf-8');
    let settings = defaultSettings;
    let caps = {};
    try {
      settings = await getSettingsLean();
      if (settings?.appVersion) setDbVersionOverride(settings.appVersion);
      caps = await getUserCapabilities();
    } catch {
      /* DB may be empty/down — still serve SPA with package version */
    }

    const orgName = settings.organizationName || 'سامانه تغذیه';
    const version = getVersionViewModel({
      appVersion: settings.appVersion,
      previousAppVersion: settings.previousAppVersion,
      appVersionUpdatedAt: settings.appVersionUpdatedAt,
    });
    const pubSettings = publicSettings(settings);

    const bootstrapData = {
      settings: pubSettings,
      capabilities: caps,
      version,
    };

    res.set('Content-Type', 'text/html');
    return res.send(injectSpaHtml(rawHtml, bootstrapData, orgName));
  } catch (err) {
    try {
      const rawHtml = fs.readFileSync(SPA_INDEX, 'utf-8');
      const version = getVersionViewModel();
      res.set('Content-Type', 'text/html');
      return res.send(injectSpaHtml(rawHtml, { settings: {}, capabilities: {}, version }, 'سامانه تغذیه'));
    } catch {
      return res.sendFile(SPA_INDEX);
    }
  }
}

module.exports = spaMiddleware;
