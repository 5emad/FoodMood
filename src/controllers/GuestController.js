const {
  listGuests,
  createGuest,
  updateGuest,
  deleteGuest,
  reserveForGuest,
  getGuestWeekReservations,
  guestTypeLabel,
} = require('../services/GuestService');

class GuestController {
  static async list(req, res, next) {
    try {
      const guests = await listGuests(req.query);
      res.json({
        success: true,
        data: guests.map((guest) => ({
          ...guest,
          guestTypeLabel: guestTypeLabel(guest.guestType),
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const guest = await createGuest(req.body, req.user?.username || req.user?.fullName || '');
      res.status(201).json({
        success: true,
        message: 'مهمان ثبت شد',
        data: { ...guest.toObject(), guestTypeLabel: guestTypeLabel(guest.guestType) },
      });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  static async update(req, res, next) {
    try {
      const guest = await updateGuest(req.params.id, req.body);
      res.json({
        success: true,
        message: 'مهمان ویرایش شد',
        data: { ...guest.toObject(), guestTypeLabel: guestTypeLabel(guest.guestType) },
      });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  static async remove(req, res, next) {
    try {
      await deleteGuest(req.params.id);
      res.json({ success: true, message: 'مهمان حذف شد' });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  static async reserve(req, res, next) {
    try {
      const menuItemId = req.body.menuItemId || req.body.menu_item_id;
      if (!menuItemId) {
        return res.status(400).json({ success: false, message: 'آیتم منو الزامی است' });
      }
      const { guest, order } = await reserveForGuest(req.params.id, menuItemId);
      res.status(201).json({
        success: true,
        message: `رزرو برای مهمان ${guest.fullName} ثبت شد`,
        data: order,
      });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  static async reservations(req, res, next) {
    try {
      const data = await getGuestWeekReservations(req.params.id, req.query.weekId);
      res.json({ success: true, data });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      next(error);
    }
  }
}

module.exports = GuestController;
