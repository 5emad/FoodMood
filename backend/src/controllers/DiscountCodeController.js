const DiscountCodeService = require('../services/DiscountCodeService');

function sendError(res, next, error) {
  if (Number(error.status) > 0 && Number(error.status) < 500) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  return next(error);
}

class DiscountCodeController {
  static async list(req, res, next) {
    try {
      return res.json({ success: true, data: await DiscountCodeService.listCodes() });
    } catch (error) {
      return next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const doc = await DiscountCodeService.createCode(req.body || {}, req.user || {});
      return res.status(201).json({ success: true, message: `کد تخفیف ${doc.code} ساخته شد`, data: doc });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async setActive(req, res, next) {
    try {
      const doc = await DiscountCodeService.setActive(req.params.id, req.body?.isActive === true);
      return res.json({ success: true, message: doc.isActive ? 'کد فعال شد' : 'کد غیرفعال شد', data: doc });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static async remove(req, res, next) {
    try {
      const doc = await DiscountCodeService.removeCode(req.params.id);
      return res.json({ success: true, message: `کد ${doc.code} حذف شد` });
    } catch (error) {
      return sendError(res, next, error);
    }
  }

  static generate(req, res) {
    res.json({ success: true, data: { code: DiscountCodeService.generateCode(8) } });
  }

  static async people(req, res, next) {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      return res.json({ success: true, data: await DiscountCodeService.searchPeople(q) });
    } catch (error) {
      return next(error);
    }
  }
}

module.exports = DiscountCodeController;
