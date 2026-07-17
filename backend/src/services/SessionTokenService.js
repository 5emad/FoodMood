const crypto = require('crypto');
const User = require('../models/User');
const UserSession = require('../models/UserSession');
const { hashSensitiveToken, compareSensitiveToken } = require('../helpers/SecurityHelper');

const DEFAULT_MAX_HOURS = 8;

function getMaxMs() {
  const hours = parseFloat(process.env.SESSION_MAX_HOURS);
  if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;
  return DEFAULT_MAX_HOURS * 60 * 60 * 1000;
}

function sessionExpiryDate() {
  return new Date(Date.now() + getMaxMs());
}

function buildSessionFilter({ userId, username, authSource = 'local' }) {
  if (authSource === 'ldap' && username) {
    return { username, authSource: 'ldap', status: 'active' };
  }
  if (userId) {
    return { userId, authSource: 'local', status: 'active' };
  }
  return null;
}

async function revokeActiveSessions(filter, reason) {
  if (!filter) return;
  await UserSession.updateMany(filter, {
    $set: {
      status: 'revoked',
      revokedAt: new Date(),
      revokeReason: reason,
    },
  });
}

async function issueSession({
  userId = null,
  username = null,
  authSource = 'local',
  sessionId = null,
  req = null,
}) {
  const sid = sessionId || crypto.randomUUID();
  const tokenHash = hashSensitiveToken(sid);
  const expiresAt = sessionExpiryDate();

  const revokeFilter = buildSessionFilter({ userId, username, authSource });
  await revokeActiveSessions(revokeFilter, 'new_login');

  await UserSession.create({
    userId: userId || null,
    username: username || null,
    sessionId: sid,
    tokenHash,
    authSource,
    status: 'active',
    issuedAt: new Date(),
    expiresAt,
    lastActivityAt: new Date(),
    ipAddress: req?.ip || null,
    userAgent: req?.get?.('user-agent') || null,
  });

  if (userId) {
    await User.findByIdAndUpdate(userId, {
      loginAttempts: 0,
      lockUntil: null,
      activeSessionId: sid,
    });
  }

  return sid;
}

async function findActiveSession(sessionId) {
  if (!sessionId) return null;
  return UserSession.findOne({ sessionId, status: 'active' }).select('+tokenHash').lean();
}

async function assertActiveUserSession({
  sessionId,
  userId = null,
  username = null,
  authSource = 'local',
  activeSessionId = null,
}) {
  if (!sessionId) {
    return { ok: false, reason: 'expired', message: 'نشست معتبر یافت نشد' };
  }

  const record = await findActiveSession(sessionId);

  if (record) {
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      await UserSession.updateOne({ sessionId }, {
        $set: { status: 'expired', revokedAt: new Date(), revokeReason: 'ttl_expired' },
      });
      return { ok: false, reason: 'expired', message: 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.' };
    }

    if (!compareSensitiveToken(sessionId, record.tokenHash)) {
      return { ok: false, reason: 'expired', message: 'نشست نامعتبر است. لطفاً دوباره وارد شوید.' };
    }

    if (authSource === 'ldap') {
      if (record.authSource !== 'ldap' || (username && record.username !== username)) {
        return { ok: false, reason: 'expired', message: 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.' };
      }
    } else if (userId) {
      if (record.authSource !== 'local' || String(record.userId) !== String(userId)) {
        return { ok: false, reason: 'expired', message: 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.' };
      }
      if (activeSessionId && sessionId !== activeSessionId) {
        return { ok: false, reason: 'expired', message: 'نشست شما در دستگاه دیگری پایان یافته است. لطفاً دوباره وارد شوید.' };
      }
    }
  } else if (authSource === 'local' && userId && activeSessionId && sessionId === activeSessionId) {
    await issueSession({ userId, authSource: 'local', sessionId, req: null });
    return { ok: true, legacy: true };
  } else {
    return { ok: false, reason: 'expired', message: 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.' };
  }

  return { ok: true };
}

async function touchSession(sessionId) {
  if (!sessionId) return;
  await UserSession.updateOne(
    { sessionId, status: 'active' },
    { $set: { lastActivityAt: new Date() } },
  ).catch(() => {});
}

async function revokeSession(sessionId, reason = 'logout') {
  if (!sessionId) return;
  await UserSession.updateOne(
    { sessionId, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date(), revokeReason: reason } },
  );
}

async function revokeUserSessions({
  userId = null,
  username = null,
  authSource = 'local',
  sessionId = null,
  reason = 'logout',
  revokeAll = false,
}) {
  if (sessionId) {
    await revokeSession(sessionId, reason);
  }

  if (revokeAll) {
    const filter = buildSessionFilter({ userId, username, authSource });
    await revokeActiveSessions(filter, reason);
  }

  if (userId) {
    await User.findByIdAndUpdate(userId, { activeSessionId: null }).catch(() => {});
  }
}

module.exports = {
  issueSession,
  assertActiveUserSession,
  touchSession,
  revokeSession,
  revokeUserSessions,
};
