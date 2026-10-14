const { getConfiguredPublicUrl, normalizePublicUrl, requestOrigin } = require('./AppUrlHelper');

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

function readConfiguredOrigins() {
  return process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((item) => normalizePublicUrl(item.trim())).filter(Boolean)
    : [];
}

function getRuntimeOriginSet(req = null) {
  const origins = new Set(readConfiguredOrigins());
  const appUrl = normalizePublicUrl(process.env.APP_URL);
  const cached = normalizePublicUrl(syncCachedPublicUrl);
  if (appUrl) origins.add(appUrl);
  if (cached) origins.add(cached);
  if (req) {
    const current = requestOrigin(req);
    if (current) origins.add(current);
  }
  if (process.env.NODE_ENV !== 'production') {
    const port = process.env.PORT || 3000;
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
  }
  return origins;
}

function isOriginAllowed(presented, req = null) {
  const normalized = normalizePublicUrl(presented);
  if (!normalized) return true;
  return getRuntimeOriginSet(req).has(normalized);
}

function applyRuntimeEnv({ publicUrl, allowedOrigins } = {}) {
  if (publicUrl) process.env.APP_URL = publicUrl;
  if (allowedOrigins) process.env.ALLOWED_ORIGINS = allowedOrigins;
  if (publicUrl) process.env.TRUST_TLS = 'true';
}

const PRE_AUTH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/resolve-username',
  '/api/auth/verify-super-token',
  '/api/auth/logout',
  '/api/auth/csrf',
  '/api/auth/captcha',
]);

/** Pre-authentication endpoints only — profile/password changes must still pass the origin check. */
function isAuthApiPath(req) {
  const path = String(req?.originalUrl || req?.url || req?.path || '').split('?')[0].replace(/\/+$/, '');
  return PRE_AUTH_PATHS.has(path);
}

refreshOriginPublicUrlCache();

module.exports = {
  refreshOriginPublicUrlCache,
  getConfiguredPublicUrlSync,
  getRuntimeOriginSet,
  isOriginAllowed,
  applyRuntimeEnv,
  isAuthApiPath,
};
