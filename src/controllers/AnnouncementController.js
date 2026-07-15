const AnnouncementService = require('../services/AnnouncementService');
const mongoose = require('mongoose');

function resolveCreatedById(user) {
  if (!user?.id || user.authSource === 'ldap') return null;
  return mongoose.Types.ObjectId.isValid(user.id) ? user.id : null;
}

function resolveExpiresAt(body) {
  if (body.jalaliExpiresAt === null || body.jalaliExpiresAt === '') return null;
  if (body.expiresAt === null || body.expiresAt === '') return null;
  if (body.jalaliExpiresAt) {
    const parsed = AnnouncementService.endOfJalaliDay(body.jalaliExpiresAt);
    if (!parsed) {
      const error = new Error('تاریخ انقضای شمسی نامعتبر است');
      error.status = 400;
      throw error;
    }
    return parsed;
  }
  if (body.expiresAt) return new Date(body.expiresAt);
  return undefined;
}

class AnnouncementController {
  static async getActive(req, res, next) {
    try {
      const data = await AnnouncementService.listActiveForUser(req.user);
      return res.json({
        success: true,
        hasActive: data.length > 0,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  static async list(req, res, next) {
    try {
      const data = await AnnouncementService.listForAdmin();
      return res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const { title, body, audience, departmentIds, isActive, expiresAt, jalaliExpiresAt } = req.body;
      if (!String(title || '').trim()) {
        return res.status(400).json({ message: 'عنوان اطلاعیه الزامی است' });
      }
      if (!String(body || '').trim()) {
        return res.status(400).json({ message: 'متن اطلاعیه الزامی است' });
      }

      const data = await AnnouncementService.createAnnouncement({
        title,
        body,
        audience,
        departmentIds,
        isActive,
        expiresAt: resolveExpiresAt({ expiresAt, jalaliExpiresAt }),
        createdBy: resolveCreatedById(req.user),
      });

      return res.status(201).json({ success: true, message: 'اطلاعیه ثبت شد', data });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) return res.status(error.status).json({ message: error.message });
      next(error);
    }
  }

  static async update(req, res, next) {
    try {
      const { title, body, audience, departmentIds, isActive, expiresAt, jalaliExpiresAt } = req.body;
      const resolvedExpires = resolveExpiresAt({ expiresAt, jalaliExpiresAt });
      const data = await AnnouncementService.updateAnnouncement(req.params.id, {
        title,
        body,
        audience,
        departmentIds,
        isActive,
        expiresAt: resolvedExpires,
      });

      return res.json({ success: true, message: 'اطلاعیه بروزرسانی شد', data });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) return res.status(error.status).json({ message: error.message });
      next(error);
    }
  }

  static async remove(req, res, next) {
    try {
      await AnnouncementService.deleteAnnouncement(req.params.id);
      return res.json({ success: true, message: 'اطلاعیه حذف شد' });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) return res.status(error.status).json({ message: error.message });
      next(error);
    }
  }
}

module.exports = AnnouncementController;
