const { resolveGuestSession, guestActor } = require('../services/GuestAccessService');

/**
 * نشست پرتال مهمان — کاملاً جدا از ورود کاربران (توکن JWT ندارد،
 * پس مسیرهای کاربران/مدیر را باز نمی‌کند). req.user = بازیگر مهمان.
 */
async function guestAuthMiddleware(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  try {
    const guest = await resolveGuestSession(req);
    if (!guest) {
      return res.status(401).json({ success: false, code: 'guest_auth', message: 'نشست مهمان منقضی شده است؛ دوباره از لینک اختصاصی وارد شوید.' });
    }
    req.guest = guest;
    req.user = guestActor(guest);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = guestAuthMiddleware;
