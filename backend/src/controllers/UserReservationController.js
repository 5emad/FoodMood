const UserReservationService = require('../services/UserReservationService');

function sendError(res, next, error) {
  const status = Number(error.status);
  if (status > 0 && status < 500) {
    return res.status(status).json({ success: false, message: error.message });
  }
  return next(error);
}

/** رزرو دستی غذا توسط مدیر/سوپر ادمین برای هفته‌های کاربران */
class UserReservationController {
  static async status(req, res, next) {
    try {
      return res.json({ success: true, data: await UserReservationService.manualReserveStatus() });
    } catch (error) {
      return next(error);
    }
  }

  static async reservations(req, res, next) {
    try {
      const data = await UserReservationService.getUserWeekReservations(req.params.id, req.query.weekId, req.user);
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async reserve(req, res, next) {
    try {
      const menuItemId = req.body?.menuItemId || req.body?.menu_item_id;
      const { user, order } = await UserReservationService.reserveForUser(req.params.id, menuItemId, req.user);
      return res.status(201).json({ success: true, message: `رزرو برای ${user.fullName} ثبت شد`, data: order });
    } catch (error) {
      return sendError(res, next, error);
    }
  }
}

module.exports = UserReservationController;
