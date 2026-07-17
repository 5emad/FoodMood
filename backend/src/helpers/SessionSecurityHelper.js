const crypto = require('crypto');
const { writeSecurityLog } = require('../services/SecurityLogService');
const { revokeUserSessions, touchSession } = require('../services/SessionTokenService');
const { clearAuthCookies } = require('./AuthCookieHelper');

const DEFAULT_IDLE_MINUTES = 30;
const DEFAULT_MAX_HOURS = 8;

const SESSION_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-sid' : 'sid';

function getIdleMs() {
  const minutes = parseInt(process.env.SESSION_IDLE_MINUTES, 10);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE_MINUTES) * 60 * 1000;
}

function getMaxMs() {
  const hours = parseFloat(process.env.SESSION_MAX_HOURS);
  if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;
  return DEFAULT_MAX_HOURS * 60 * 60 * 1000;
}

function shouldBindUserAgent() {
  return process.env.SESSION_BIND_UA !== 'false';
}

function fingerprintUserAgent(userAgent) {
  return crypto.createHash('sha256').update(String(userAgent || '')).digest('hex').slice(0, 32);
}

function initSessionSecurity(req) {
  if (!req.session) return;
  const now = Date.now();
  req.session.lastActivityAt = now;
  req.session.sessionStartedAt = now;
  if (shouldBindUserAgent()) {
    req.session.clientFingerprint = fingerprintUserAgent(req.headers['user-agent']);
  }
}

function assertActiveSession(req) {
  if (!req.session?.token) {
    try {
      const { readAuthTokenFromCookie } = require('./AuthCookieHelper');
      if (readAuthTokenFromCookie(req)) return { ok: true };
    } catch {
      // ignore
    }
    return { ok: true };
  }

  const now = Date.now();
  if (!req.session.lastActivityAt) req.session.lastActivityAt = now;
  if (!req.session.sessionStartedAt) req.session.sessionStartedAt = now;

  const lastActivity = Number(req.session.lastActivityAt);
  const sessionStarted = Number(req.session.sessionStartedAt);

  if (lastActivity && now - lastActivity > getIdleMs()) {
    return {
      ok: false,
      reason: 'idle',
      message: 'به دلیل عدم فعالیت، نشست شما پایان یافت. لطفاً دوباره وارد شوید.',
    };
  }

  if (sessionStarted && now - sessionStarted > getMaxMs()) {
    return {
      ok: false,
      reason: 'expired',
      message: 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.',
    };
  }

  if (shouldBindUserAgent() && req.session.clientFingerprint) {
    const current = fingerprintUserAgent(req.headers['user-agent']);
    if (current !== req.session.clientFingerprint) {
      return {
        ok: false,
        reason: 'hijack',
        message: 'نشست شما به دلیل تغییر محیط مرورگر باطل شد. لطفاً دوباره وارد شوید.',
      };
    }
  }

  return { ok: true };
}

function touchSessionActivity(req) {
  if (!req.session?.token) return;
  req.session.lastActivityAt = Date.now();
}

function getSessionPolicy() {
  return {
    idleMs: getIdleMs(),
    maxMs: getMaxMs(),
    idleMinutes: Math.round(getIdleMs() / 60000),
    maxHours: getMaxMs() / (60 * 60 * 1000),
  };
}

function commitAuthenticatedSession(req, sessionPayload) {
  return new Promise((resolve, reject) => {
    const assign = () => {
      Object.assign(req.session, sessionPayload);
      initSessionSecurity(req);
      req.session.save((err) => (err ? reject(err) : resolve()));
    };

    if (typeof req.session.regenerate === 'function') {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        assign();
      });
      return;
    }

    assign();
  });
}

async function invalidateSession(req, res, reason) {
  const username = req.session?.username || '';
  const logType = reason === 'idle'
    ? 'session_idle_timeout'
    : reason === 'hijack'
      ? 'session_hijack_suspect'
      : 'session_invalidated';

  await writeSecurityLog(req, logType, null, `Session ended: ${reason}`, { username, reason });

  const userId = req.session?.authSource === 'local' ? req.session?.userId : null;
  const authSource = req.session?.authSource || 'local';
  const sessionId = req.session?.sessionId || null;

  await revokeUserSessions({
    userId,
    username: username || null,
    authSource,
    sessionId,
    reason,
  });

  return new Promise((resolve) => {
    if (!req.session) {
      res?.clearCookie?.(SESSION_COOKIE_NAME, { path: '/', secure: process.env.TRUST_TLS === 'true' });
      clearAuthCookies(res);
      return resolve();
    }
    req.session.destroy(() => {
      res?.clearCookie?.(SESSION_COOKIE_NAME, { path: '/', secure: process.env.TRUST_TLS === 'true' });
      clearAuthCookies(res);
      resolve();
    });
  });
}

module.exports = {
  SESSION_COOKIE_NAME,
  getIdleMs,
  getMaxMs,
  initSessionSecurity,
  assertActiveSession,
  touchSessionActivity,
  getSessionPolicy,
  commitAuthenticatedSession,
  invalidateSession,
  touchStoredSession: touchSession,
};
