const crypto = require('crypto');

function ownerKeyOfUser(user = {}) {
  if (user.guestCode || user.guestId) {
    return `guest:${user.guestCode || user.guestId}`;
  }
  if (user.ldapUsername) return `ldap:${user.ldapUsername}`;
  if (user.username) return `user:${user.username}`;
  return `id:${user.id || user._id || 'unknown'}`;
}

/**
 * Stable unique statement number per user/guest + period (same period always returns same number).
 */
function buildStatementNumber(user, periodType, periodKey) {
  const ownerKey = ownerKeyOfUser(user);
  const seed = `${ownerKey}|${periodType}|${periodKey}`;
  const digest = crypto.createHash('sha256').update(seed).digest('hex');
  const numeric = (parseInt(digest.slice(0, 8), 16) % 900000) + 100000;
  const isGuest = ownerKey.startsWith('guest:');
  const prefix = isGuest
    ? (periodType === 'week' ? 'GSW' : 'GSM')
    : (periodType === 'week' ? 'FSW' : 'FSM');
  return `${prefix}-${numeric}`;
}

module.exports = {
  buildStatementNumber,
  ownerKeyOfUser,
};
