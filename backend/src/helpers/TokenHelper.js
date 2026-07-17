const jwt = require('jsonwebtoken');

const DEFAULT_EXPIRE = '8h';

const generateToken = (userId, email, role, username, sessionId) => {
  return jwt.sign(
    {
      id: String(userId),
      email,
      username,
      role,
      sessionId,
      jti: sessionId,
      authSource: 'local',
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || DEFAULT_EXPIRE },
  );
};

const generateLdapToken = ({ username, email, fullName, department, sessionId, role = 'user' }) => {
  const normalizedRole = role === 'admin' ? 'admin' : 'user';
  return jwt.sign(
    {
      id: `ldap:${username}`,
      authSource: 'ldap',
      username,
      email: email || null,
      fullName: fullName || username,
      department: department || null,
      role: normalizedRole,
      sessionId,
      jti: sessionId,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || DEFAULT_EXPIRE },
  );
};

const verifyToken = (token) => {
  try {
    if (!token || typeof token !== 'string') return null;
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
};

module.exports = { generateToken, generateLdapToken, verifyToken };
