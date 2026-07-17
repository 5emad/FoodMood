const { verifyToken } = require('./TokenHelper');
const { isLdapAuth } = require('./AuthUserHelper');

/**
 * Single source of truth: merge JWT payload with express-session data.
 */
function resolveSessionUser(req, decoded) {
  const session = req.session || {};
  const authSource = decoded.authSource || session.authSource || (isLdapAuth(decoded) ? 'ldap' : 'local');

  if (authSource === 'ldap') {
    return {
      id: decoded.id || `ldap:${session.username || ''}`,
      authSource: 'ldap',
      username: decoded.username || session.username,
      fullName: decoded.fullName || session.fullName || decoded.username || session.username,
      email: decoded.email || session.email || null,
      department: decoded.department || session.department || null,
      role: decoded.role || session.userRole || 'user',
      sessionId: decoded.sessionId || session.sessionId,
    };
  }

  return {
    id: String(decoded.id || session.userId || ''),
    authSource: 'local',
    username: decoded.username || session.username,
    fullName: decoded.fullName || session.fullName,
    email: decoded.email || null,
    role: decoded.role || session.userRole || 'user',
    sessionId: decoded.sessionId || session.sessionId,
  };
}

const { readAuthTokenFromCookie } = require('./AuthCookieHelper');

function readAuthToken(req) {
  const raw = (v) => (v && v !== 'null' && v !== 'undefined' ? v : null);
  return raw(req.headers.authorization?.split(' ')[1])
    || raw(req.session?.token)
    || raw(readAuthTokenFromCookie(req))
    || null;
}

function readAuthContext(req) {
  const token = readAuthToken(req);
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded) return null;
  return {
    token,
    decoded,
    user: resolveSessionUser(req, decoded),
  };
}

module.exports = {
  resolveSessionUser,
  readAuthToken,
  readAuthContext,
};
