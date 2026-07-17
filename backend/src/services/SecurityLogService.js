const SecurityLog = require('../models/SecurityLog');

async function writeSecurityLog(req, type, targetUser, message = '', metadata = {}) {
  await SecurityLog.create({
    type,
    username: targetUser?.username || metadata.username || '',
    userId: targetUser?._id || null,
    role: targetUser?.role || '',
    ip: req.ip || req.connection?.remoteAddress || '',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    message,
    metadata,
  }).catch((err) => {
    console.error('SecurityLog write failed:', err.message);
  });
}

module.exports = { writeSecurityLog };
