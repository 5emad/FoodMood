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

function timingSafeEqualStr(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function verifySignedRole(value) {
  const raw = String(value || '');
  const dot = raw.indexOf('.');
  if (dot <= 0) return '';
  const role = raw.slice(dot + 1);
  if (!role) return '';
  const expected = signRole(role);
  if (!expected || !timingSafeEqualStr(expected, raw)) return '';
  return role;
}

function setAuthCookies(res, { token, role }) {
  if (!res?.cookie) return;
  const opts = cookieOptions();
  if (token) res.cookie(authCookieName(), token, opts);
  if (role) res.cookie(roleCookieName(), signRole(role), opts);
}

function clearAuthCookies(res) {
  if (!res?.clearCookie) return;
  const secure = prefersSecureCookies();
  const opts = { path: '/', secure, sameSite: 'strict', httpOnly: true };
  res.clearCookie(authCookieName(), opts);
  res.clearCookie(roleCookieName(), opts);
  // legacy names
  res.clearCookie('fm-auth', { path: '/', sameSite: 'strict' });
  res.clearCookie('fm-role', { path: '/', sameSite: 'strict' });
}

function readAuthTokenFromCookie(req) {
  return parseCookieHeader(req, authCookieName())
    || parseCookieHeader(req, 'fm-auth')
    || null;
}

function readRoleFromCookie(req) {
  return verifySignedRole(parseCookieHeader(req, roleCookieName()))
    || verifySignedRole(parseCookieHeader(req, 'fm-role'));
}

/** Health-gate helper: require a valid JWT (not role cookie alone). */
function isSuperadminRequest(req) {
  if (req.session?.userRole === 'superadmin' && req.session?.token) {
    try {
      const { verifyToken } = require('./TokenHelper');
      const decoded = verifyToken(req.session.token);
      if (decoded?.role === 'superadmin') return true;
    } catch { /* fall through */ }
  }
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
