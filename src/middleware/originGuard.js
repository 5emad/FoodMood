const { getConfiguredPublicUrl, normalizePublicUrl, requestOrigin } = require('../helpers/AppUrlHelper');

function allowedOrigins(req) {
  const configured = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((item) => normalizePublicUrl(item.trim())).filter(Boolean)
    : [];
  const appUrl = normalizePublicUrl(process.env.APP_URL);
  const cached = normalizePublicUrl(getConfiguredPublicUrlSync());
  const requestOriginValue = requestOrigin(req);
  return new Set([requestOriginValue, appUrl, cached, ...configured].filter(Boolean));
}

let syncCachedPublicUrl = '';

function getConfiguredPublicUrlSync() {
  return syncCachedPublicUrl;
}

async function refreshOriginPublicUrlCache() {
  try {
    syncCachedPublicUrl = await getConfiguredPublicUrl();
  } catch {
    syncCachedPublicUrl = normalizePublicUrl(process.env.APP_URL);
  }
}

refreshOriginPublicUrlCache();

async function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  const presented = origin ? normalizePublicUrl(origin) : normalizePublicUrl(referer || '');

  if (!presented) {
    if (req.headers.authorization?.startsWith('Bearer ')) return next();
    return res.status(403).json({ success: false, message: 'درخواست بدون مبدا معتبر رد شد' });
  }

  if (!allowedOrigins(req).has(presented)) {
    return res.status(403).json({ success: false, message: 'مبدا درخواست مجاز نیست' });
  }

  next();
}

module.exports = originGuard;
module.exports.refreshOriginPublicUrlCache = refreshOriginPublicUrlCache;
