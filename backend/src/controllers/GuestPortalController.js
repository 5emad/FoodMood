const GuestAccessService = require('../services/GuestAccessService');
const { reserveForGuest } = require('../services/GuestService');
const { getUserCapabilities, stripPricesFromOrder } = require('../helpers/PermissionHelper');
const { decorateOrder } = require('../helpers/OrderStatusHelper');
const { getSettingsLean } = require('../services/SettingsService');

function sendError(res, next, error) {
  const status = Number(error.status);
  if (status > 0 && status < 500) {
    return res.status(status).json({ success: false, message: error.message, code: error.code });
  }
  return next(error);
}

function tokenFrom(req) {
  return String(req.body?.token || '').trim();
}

class GuestPortalController {
  /** کپچای کانال مهمان (کلید نشست جدا از ورود کارکنان) */
  static captcha(req, res, next) {
    try {
      const challenge = GuestAccessService.guestCaptcha(req);
      res.setHeader('Cache-Control', 'no-store');
      req.session.save((err) => (err ? next(err) : res.json({ success: true, data: challenge })));
    } catch (error) {
      next(error);
    }
  }

  /** آیا نشست مهمان معتبر است؟ (بدون 401 برای صفحه ورود) */
  static async session(req, res, next) {
    try {
      const guest = await GuestAccessService.resolveGuestSession(req);
      const settings = await getSettingsLean().catch(() => ({}));
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ success: true, data: { loggedIn: !!guest, organizationName: settings.organizationName || 'سامانه تغذیه' } });
    } catch (error) {
      return next(error);
    }
  }

  static async login(req, res, next) {
    try {
      const guest = await GuestAccessService.loginWithPassword(req, {
        code: req.body?.code,
        password: req.body?.password,
        captcha: req.body?.captcha,
      });
      return res.json({ success: true, message: `خوش آمدید ${guest.fullName}` });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  /** ورود با لینک مستقیم (توکن در بدنه POST، نه در لاگ آدرس‌ها) */
  static async magic(req, res, next) {
    try {
      const guest = await GuestAccessService.loginWithMagicLink(req, tokenFrom(req));
      return res.json({ success: true, message: `خوش آمدید ${guest.fullName}` });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static logout(req, res) {
    GuestAccessService.logout(req);
    res.json({ success: true });
  }

  static me(req, res) {
    const g = req.guest;
    res.json({
      success: true,
      user: {
        _id: `guest:${g._id}`,
        username: g.guestCode,
        fullName: g.fullName,
        role: 'guest',
        isGuest: true,
        guestType: g.guestType,
        validUntil: g.validUntil,
        department: { name: g.department || 'مهمان' },
      },
    });
  }

  static async bootstrap(req, res, next) {
    try {
      const capabilities = await getUserCapabilities();
      res.json({
        success: true,
        data: {
          capabilities,
          portalSettings: {
            showFinancialStatementToUsers: capabilities.showStatement,
            organizationSharePercent: capabilities.organizationSharePercent,
            personalSharePercent: capabilities.personalSharePercent,
            showPricesToUsers: capabilities.showPrices,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /** رزرو توسط خود مهمان — مثل کاربران «در انتظار» (تایید مدیر یا تایید خودکار پس از پرداخت) */
  static async createOrder(req, res, next) {
    try {
      const menuItemId = req.body?.menuItemId || req.body?.menu_item_id;
      if (!menuItemId || !/^[a-f0-9]{24}$/i.test(String(menuItemId))) {
        return res.status(400).json({ success: false, message: 'آیتم منو نامعتبر است' });
      }
      const { order } = await reserveForGuest(req.guest._id, String(menuItemId), { status: 'pending' });
      const showPrices = (await getUserCapabilities()).showPrices;
      return res.status(201).json({
        success: true,
        message: 'رزرو شما ثبت شد',
        orderId: order._id,
        data: stripPricesFromOrder(decorateOrder(order), showPrices),
      });
    } catch (error) {
      return sendError(res, next, error);
    }
  }
}

module.exports = GuestPortalController;
