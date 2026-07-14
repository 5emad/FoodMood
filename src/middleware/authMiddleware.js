const { verifyToken } = require('../helpers/TokenHelper');
const { isLdapAuth } = require('../helpers/AuthUserHelper');
const { resolveSessionUser, readAuthToken } = require('../helpers/SessionUserHelper');
const {
  assertActiveSession,
  touchSessionActivity,
  getSessionPolicy,
  invalidateSession,
} = require('../helpers/SessionSecurityHelper');
const { isDatabaseError } = require('../helpers/HealthState');
const { buildAbsoluteUrl } = require('../helpers/AppUrlHelper');
const { assertActiveUserSession, touchSession } = require('../services/SessionTokenService');
const User = require('../models/User');

function wantsHtml(req) {
  return req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/');
}

function setNoCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function loginRedirectForReason(reason) {
  if (reason === 'idle') return '/login?idle=1';
  if (reason === 'inactive') return '/login?inactive=1';
  return '/login?expired=1';
}

async function htmlLoginRedirect(req, res, reason = 'expired') {
  const target = await buildAbsoluteUrl(req, loginRedirectForReason(reason));
  return res.redirect(target);
}

const authMiddleware = async (req, res, next) => {
  setNoCache(res);

  try {
    const sessionCheck = assertActiveSession(req);
    if (!sessionCheck.ok) {
      await invalidateSession(req, res, sessionCheck.reason);
      if (wantsHtml(req)) return htmlLoginRedirect(req, res, sessionCheck.reason);
      return res.status(401).json({
        message: sessionCheck.message,
        code: sessionCheck.reason,
      });
    }

    const token = readAuthToken(req);

    if (!token) {
      if (wantsHtml(req)) return htmlLoginRedirect(req, res, 'expired');
      return res.status(401).json({ message: 'توکن ارائه نشده است' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      await invalidateSession(req, res, 'expired');
      if (wantsHtml(req)) return htmlLoginRedirect(req, res, 'expired');
      return res.status(401).json({ message: 'توکن نامعتبر یا منقضی شده است' });
    }

    const user = resolveSessionUser(req, decoded);

    if (!user.sessionId || (req.session?.sessionId && user.sessionId !== req.session.sessionId)) {
      await invalidateSession(req, res, 'expired');
      if (wantsHtml(req)) return htmlLoginRedirect(req, res, 'expired');
      return res.status(401).json({ message: 'سشن شما منقضی شده است. لطفاً دوباره وارد شوید.' });
    }

    if (isLdapAuth(user)) {
      const ldapSession = await assertActiveUserSession({
        sessionId: user.sessionId,
        username: user.username,
        authSource: 'ldap',
      });
      if (!ldapSession.ok) {
        await invalidateSession(req, res, ldapSession.reason || 'expired');
        if (wantsHtml(req)) return htmlLoginRedirect(req, res, ldapSession.reason || 'expired');
        return res.status(401).json({ message: ldapSession.message || 'نشست شما منقضی شده است' });
      }
      req.user = user;
      touchSessionActivity(req);
      await touchSession(user.sessionId);
      res.locals.sessionPolicy = getSessionPolicy();
      return next();
    }

    const dbUser = await User.findById(user.id).select('activeSessionId status role').lean();
    if (!dbUser || dbUser.status !== 'active') {
      await invalidateSession(req, res, 'expired');
      if (wantsHtml(req)) return htmlLoginRedirect(req, res, 'inactive');
      return res.status(401).json({ message: 'حساب کاربری غیرفعال یا یافت نشد' });
    }

    // Role in the token must match the current DB role — a demoted admin
    // must not keep elevated access until the JWT expires.
    if (dbUser.role !== user.role) {
      await invalidateSession(req, res, 'expired');
      if (wantsHtml(req)) return htmlLoginRedirect(req, res, 'expired');
      return res.status(401).json({ message: 'سطح دسترسی شما تغییر کرده است. لطفاً دوباره وارد شوید.' });
    }

    const sessionState = await assertActiveUserSession({
      sessionId: user.sessionId,
      userId: user.id,
      authSource: 'local',
      activeSessionId: dbUser.activeSessionId,
    });
    if (!sessionState.ok) {
      await invalidateSession(req, res, sessionState.reason || 'expired');
      if (wantsHtml(req)) return htmlLoginRedirect(req, res, sessionState.reason || 'expired');
      return res.status(401).json({ message: sessionState.message || 'نشست شما منقضی شده است' });
    }

    req.user = user;
    touchSessionActivity(req);
    await touchSession(user.sessionId);
    res.locals.sessionPolicy = getSessionPolicy();
    next();
  } catch (error) {
    if (isDatabaseError(error)) return next(error);
    if (wantsHtml(req)) return htmlLoginRedirect(req, res, 'expired');
    return res.status(401).json({ message: 'خطا در احراز هویت' });
  }
};

module.exports = authMiddleware;
