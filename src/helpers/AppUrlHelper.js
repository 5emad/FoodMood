const { getSettingsLean } = require('../services/SettingsService');

let cachedPublicUrl = '';
let cacheExpiresAt = 0;
const CACHE_MS = 30 * 1000;

function prefersHttps() {
  if (process.env.TRUST_TLS === 'true') return true;
  return /^https:\/\//i.test(process.env.APP_URL || '');
}

function defaultScheme() {
  return prefersHttps() ? 'https' : 'http';
}

function normalizePublicUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const withProtocol = raw.includes('://') ? raw : `${defaultScheme()}://${raw}`;
    const url = new URL(withProtocol);
    if (!prefersHttps() && url.protocol === 'https:' && !/^https:\/\//i.test(raw)) {
      url.protocol = 'http:';
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

function requestOrigin(req) {
  if (!req) return '';
  const host = req.get('host');
  if (!host) return '';
  return normalizePublicUrl(`${req.protocol}://${host}`);
}

async function getConfiguredPublicUrl() {
  const now = Date.now();
  if (now < cacheExpiresAt) return cachedPublicUrl;

  let fromSettings = '';
  try {
    const settings = await getSettingsLean();
    fromSettings = normalizePublicUrl(settings?.publicUrl);
  } catch {
    fromSettings = '';
  }

  cachedPublicUrl = fromSettings || normalizePublicUrl(process.env.APP_URL);
  cacheExpiresAt = now + CACHE_MS;
  return cachedPublicUrl;
}

function refreshPublicUrlCache(url) {
  cachedPublicUrl = normalizePublicUrl(url) || normalizePublicUrl(process.env.APP_URL);
  cacheExpiresAt = Date.now() + CACHE_MS;
}

async function resolvePublicUrl(req) {
  const configured = await getConfiguredPublicUrl();
  return configured || requestOrigin(req);
}

function buildAppPath(path) {
  const normalized = String(path || '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

async function buildAbsoluteUrl(req, path) {
  const base = await resolvePublicUrl(req);
  if (!base) return buildAppPath(path);
  return `${base.replace(/\/$/, '')}${buildAppPath(path)}`;
}

function shouldEnforceCanonicalHost() {
  return process.env.FORCE_APP_URL === 'true';
}

function isLocalOrigin(origin) {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function shouldSkipCanonicalRedirect(req) {
  if (!req || req.method !== 'GET') return true;
  const path = req.path || '';
  if (path.startsWith('/vendor/') || path.startsWith('/css/') || path.startsWith('/js/')) return true;
  if (path === '/api/system/health') return true;
  return false;
}

module.exports = {
  normalizePublicUrl,
  prefersHttps,
  defaultScheme,
  requestOrigin,
  getConfiguredPublicUrl,
  refreshPublicUrlCache,
  resolvePublicUrl,
  buildAppPath,
  buildAbsoluteUrl,
  shouldEnforceCanonicalHost,
  isLocalOrigin,
  shouldSkipCanonicalRedirect,
};
