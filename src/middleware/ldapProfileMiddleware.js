const { isLdapAuth } = require('../helpers/AuthUserHelper');
const { needsProfileSetup } = require('../helpers/LdapProfileHelper');
const { buildAbsoluteUrl } = require('../helpers/AppUrlHelper');

const ALLOWED_PREFIXES = [
  '/complete-profile',
  '/api/auth/set-fullname',
  '/api/auth/logout',
  '/api/auth/ping',
  '/api/auth/me',
  '/logout',
];

function wantsHtml(req) {
  return req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/');
}

function isAllowedPath(pathname) {
  return ALLOWED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

const ldapProfileMiddleware = async (req, res, next) => {
  try {
    if (!req.user || !isLdapAuth(req.user)) return next();

    const pathname = String(req.path || '').split('?')[0];
    if (isAllowedPath(pathname)) return next();

    const pending = await needsProfileSetup(req.user.username);
    if (!pending) return next();

    if (wantsHtml(req)) {
      const target = await buildAbsoluteUrl(req, '/complete-profile');
      return res.redirect(target);
    }

    return res.status(403).json({
      success: false,
      mustSetFullName: true,
      message: 'لطفاً نام و نام خانوادگی فارسی خود را تکمیل کنید',
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = ldapProfileMiddleware;
