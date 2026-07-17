const { getUserCapabilities, capabilitiesApiShape, statementDisabledPayload } = require('../helpers/PermissionHelper');
const { getSettingsLean } = require('../services/SettingsService');
const { buildUserStatement, getUserStatementMonths, getUserStatementWeeks, listUserStatements } = require('../services/UserStatementService');

class UserStatementController {
  static async getStatement(req, res, next) {
    try {
      const capabilities = await getUserCapabilities();
      if (!capabilities.showStatement) {
        return res.json(statementDisabledPayload(capabilities));
      }

      const settings = await getSettingsLean();
      const statement = await buildUserStatement(req.user, req.query, settings);
      return res.json({ success: true, data: statement });
    } catch (error) {
      if (Number(error.status) > 0 && Number(error.status) < 500) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      return next(error);
    }
  }

  static async getMonths(req, res, next) {
    try {
      const capabilities = await getUserCapabilities();
      if (!capabilities.showStatement) {
        return res.json({ success: true, data: [] });
      }

      const months = await getUserStatementMonths(req.user);
      return res.json({ success: true, data: months });
    } catch (error) {
      return next(error);
    }
  }

  static async getList(req, res, next) {
    try {
      const capabilities = await getUserCapabilities();
      if (!capabilities.showStatement) {
        return res.json({ ...statementDisabledPayload(capabilities), data: [] });
      }

      const settings = await getSettingsLean();
      const type = req.query.type === 'month' ? 'month' : 'week';
      const statements = await listUserStatements(req.user, type, settings);
      return res.json({ success: true, data: statements });
    } catch (error) {
      return next(error);
    }
  }

  static async getWeeks(req, res, next) {
    try {
      const capabilities = await getUserCapabilities();
      if (!capabilities.showStatement) {
        return res.json({ success: true, data: [] });
      }

      const weeks = await getUserStatementWeeks(req.user);
      return res.json({ success: true, data: weeks });
    } catch (error) {
      return next(error);
    }
  }

  static async getConfig(req, res, next) {
    try {
      const capabilities = await getUserCapabilities();
      return res.json({
        success: true,
        data: capabilitiesApiShape(capabilities),
      });
    } catch (error) {
      return next(error);
    }
  }
}

module.exports = UserStatementController;
