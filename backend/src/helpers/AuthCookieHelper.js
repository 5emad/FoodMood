const crypto = require('crypto');

function defaultMaxAgeMs() {
  const hours = parseFloat(process.env.SESSION_MAX_HOURS);
  if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;
  return 8 * 60 * 60 * 1000;
}

function prefersSecureCookies() {
  const isProduction = process.env.NODE_ENV === 'production';
  const trustTls = process.env.TRUST_TLS === 'true'
    || /^https:\/\//i.test(process.env.APP_URL || '');
  return isProduction && trustTls;
}

function authCookieName() {
  return prefersSecureCookies() ? '__Host-fm-auth' : 'fm-auth';
}

function roleCookieName() {
  return prefersSecureCookies() ? '__Host-fm-role' : 'fm-role';
}

function cookieOptions(maxAgeMs = defaultMaxAgeMs()) {
  const secure = prefersSecureCookies();
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: maxAgeMs,
  };
}

function parseCookieHeader(req, name) {
  const header = String(req?.headers?.cookie || '');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = header.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function signRole(role) {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || '';
  if (!secret || !role) return '';
  const sig = crypto.createHmac('sha256', secret).update(String(role)).digest('base64url');
  return `${sig}.${role}`;
}

function verifySignedRole(value) {
  const raw = String(value || '');
  const dot = raw.indexOf('.');
  if (dot <= 0) return '';
  const sig = raw.slice(0, dot);
  const role = raw.slice(dot + 1);
  if (!role) return '';
  if (signRole(role) === raw) return role;
  return '';
}

function setAuthCookies(res, { token, role }) {
  if (!res?.cookie) return;
  const opts = cookieOptions();
  if (token) res.cookie(authCookieName(), token, opts);
  if (role) res.cookie(roleCookieName(), signRole(role), opts);
}

function clearAuthCookies(res) {
  if (!res?.clearCookie) return;
  const opts = { path: '/', secure: prefersSecureCookies() };
  res.clearCookie(authCookieName(), opts);
  res.clearCookie(roleCookieName(), opts);
}

function readAuthTokenFromCookie(req) {
  return parseCookieHeader(req, authCookieName()) || null;
}

function readRoleFromCookie(req) {
  return verifySignedRole(parseCookieHeader(req, roleCookieName()));
}

function isSuperadminRequest(req) {
  if (req.session?.userRole === 'superadmin') return true;
  if (readRoleFromCookie(req) === 'superadmin') return true;
  const token = req.session?.token || readAuthTokenFromCookie(req);
  if (!token) return false;
  try {
    const { verifyToken } = require('./TokenHelper');
    const decoded = verifyToken(token);
    return decoded?.role === 'superadmin';
  } catch {
    return false;
  }
}

module.exports = {
  authCookieName,
  roleCookieName,
  setAuthCookies,
  clearAuthCookies,
  readAuthTokenFromCookie,
  readRoleFromCookie,
  isSuperadminRequest,
};
