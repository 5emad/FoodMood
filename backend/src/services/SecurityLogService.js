const SecurityLog = require('../models/SecurityLog');
const { encryptField, encryptJsonObject } = require('../helpers/LogCryptoHelper');
const { resolveClientIp } = require('../helpers/ClientIpHelper');

async function writeSecurityLog(req, type, targetUser, message = '', metadata = {}) {
  await SecurityLog.create({
    type,
    username: targetUser?.username || metadata.username || '',
    userId: targetUser?._id || null,
    role: targetUser?.role || '',
    ip: encryptField(resolveClientIp(req)),
    userAgent: encryptField(String(req.headers['user-agent'] || '').slice(0, 300)),
    message: encryptField(message),
    metadata: { enc: encryptJsonObject(metadata) },
  }).catch((err) => {
    console.error('SecurityLog write failed:', err.message);
  });
}

module.exports = { writeSecurityLog };
