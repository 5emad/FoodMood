const SurveyService = require('../services/SurveyService');

class SurveyController {
  static async adminGet(req, res, next) {
    try {
      const data = await SurveyService.getConfig();
      return res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  static async adminUpdateStatements(req, res, next) {
    try {
      const statements = req.body?.statements;
      if (!Array.isArray(statements)) {
        return res.status(400).json({ success: false, message: 'لیست جملات نامعتبر است' });
      }
      const data = await SurveyService.updateStatements(
        statements,
        req.user?.username || '',
      );
      return res.json({ success: true, message: 'جملات ذخیره شد', data });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  static async adminSetActive(req, res, next) {
    try {
      const isActive = req.body?.isActive !== false && req.body?.isActive !== 'false';
      const data = await SurveyService.setActive(isActive, req.user?.username || '');
      return res.json({
        success: true,
        message: isActive ? 'نظرسنجی فعال شد' : 'نظرسنجی غیرفعال شد',
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  static async adminResults(req, res, next) {
    try {
      const days = Number(req.query.days || 14);
      const data = await SurveyService.getResults({ days });
      return res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  static async userActive(req, res, next) {
    try {
      const data = await SurveyService.getActiveForUser(req.user);
      return res.json({
        success: true,
        hasActive: Boolean(data),
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  static async userRespond(req, res, next) {
    try {
      const {
        activationId,
        bestFoodId,
        selectedStatementIds,
        skipped,
      } = req.body || {};
      const data = await SurveyService.respond({
        user: req.user,
        activationId,
        bestFoodId,
        selectedStatementIds,
        skipped: !!skipped,
      });
      return res.json({
        success: true,
        message: skipped ? 'نظرسنجی رد شد' : 'از مشارکت شما سپاسگزاریم',
        data,
      });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      next(error);
    }
  }
}

module.exports = SurveyController;
