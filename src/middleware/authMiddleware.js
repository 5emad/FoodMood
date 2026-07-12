const { verifyToken } = require('../helpers/TokenHelper');
const { isLdapAuth } = require('../helpers/AuthUserHelper');
const { resolveSessionUser, readAuthToken } = require('../helpers/SessionUserHelper');
const {
  assertActiveSession,
  touchSessionActivity,
  getSessionPolicy,
  invalidateSession,
} = require('../helpers/SessionSecurityHelper');
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
  return '/login?expired=1';
}

const authMiddleware = async (req, res, next) => {
  setNoCache(res);

  try {
    const sessionCheck = assertActiveSession(req);
    if (!sessionCheck.ok) {
      await invalidateSession(req, res, sessionCheck.reason);
      if (wantsHtml(req)) return res.redirect(loginRedirectForReason(sessionCheck.reason));
      return res.status(401).json({
        message: sessionCheck.message,
        code: sessionCheck.reason,
      });
    }

    const token = readAuthToken(req);

    if (!token) {
      if (wantsHtml(req)) return res.redirect('/login');
      return res.status(401).json({ message: 'توکن ارائه نشده است' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      await invalidateSession(req, res, 'expired');
      if (wantsHtml(req)) return res.redirect('/login?expired=1');
      return res.status(401).json({ message: 'توکن نامعتبر یا منقضی شده است' });
    }

    const user = resolveSessionUser(req, decoded);

    if (!user.sessionId || !req.session?.sessionId || user.sessionId !== req.session.sessionId) {
      await invalidateSession(req, res, 'expired');
      if (wantsHtml(req)) return res.redirect('/login?expired=1');
      return res.status(401).json({ message: 'سشن شما منقضی شده است. لطفاً دوباره وارد شوید.' });
    }

    if (isLdapAuth(user)) {
      req.user = user;
      touchSessionActivity(req);
      res.locals.sessionPolicy = getSessionPolicy();
      return next();
    }

    const dbUser = await User.findById(user.id).select('activeSessionId status role').lean();
    if (!dbUser || dbUser.status !== 'active') {
      await invalidateSession(req, res, 'expired');
      if (wantsHtml(req)) return res.redirect('/login');
      return res.status(401).json({ message: 'حساب کاربری غیرفعال یا یافت نشد' });
    }

    if (user.sessionId && dbUser.activeSessionId && user.sessionId !== dbUser.activeSessionId) {
      await invalidateSession(req, res, 'expired');
      if (wantsHtml(req)) return res.redirect('/login?expired=1');
      return res.status(401).json({ message: 'سشن شما در دستگاه دیگری شروع شده است. لطفاً دوباره وارد شوید.' });
    }

    req.user = user;
    touchSessionActivity(req);
    res.locals.sessionPolicy = getSessionPolicy();
    next();
  } catch (error) {
    if (wantsHtml(req)) return res.redirect('/login');
    return res.status(401).json({ message: 'خطا در احراز هویت' });
  }
};

module.exports = authMiddleware;
