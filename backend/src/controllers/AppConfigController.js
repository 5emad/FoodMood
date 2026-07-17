const { getSettingsLean, defaultSettings } = require('../services/SettingsService');
const { getVersionViewModel } = require('../helpers/AppVersionHelper');

function withVersion(data) {
  return { ...data, ...getVersionViewModel() };
}

class AppConfigController {
  static async publicConfig(_req, res, next) {
    try {
      const settings = await getSettingsLean().catch(() => defaultSettings);
      const version = getVersionViewModel();
      res.json({
        success: true,
        data: {
          organizationName: settings?.organizationName || 'سامانه تغذیه',
          ...version,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async adminBootstrap(req, res, next) {
    try {
      const { getAdminCapabilities } = require('../helpers/PermissionHelper');
      const { adminWorkspaceSettings } = require('../services/SettingsService');
      const [capabilities, settings] = await Promise.all([
        getAdminCapabilities(req.user),
        getSettingsLean(),
      ]);
      res.json({
        success: true,
        data: withVersion({
          currentUserRole: req.user?.role || '',
          isSuperadmin: capabilities.isSuperadmin,
          currentUserId: req.user?.id || '',
          appSettings: adminWorkspaceSettings(settings),
          reportsAccess: capabilities.reportsAccess,
          capabilities,
        }),
      });
    } catch (error) {
      next(error);
    }
  }

  static async userBootstrap(req, res, next) {
    try {
      const { getUserCapabilities } = require('../helpers/PermissionHelper');
      const capabilities = await getUserCapabilities();
      res.json({
        success: true,
        data: withVersion({
          user: req.user,
          capabilities,
          portalSettings: {
            showFinancialStatementToUsers: capabilities.showStatement,
            organizationSharePercent: capabilities.organizationSharePercent,
            personalSharePercent: capabilities.personalSharePercent,
            showPricesToUsers: capabilities.showPrices,
          },
        }),
      });
    } catch (error) {
      next(error);
    }
  }

  static async getPortalSlider(req, res, next) {
    try {
      const { buildPortalSlides } = require('../services/PortalSliderService');
      const payload = await buildPortalSlides({ user: req.user });
      res.json({ success: true, data: payload });
    } catch (error) {
      next(error);
    }
  }

  static async adminDashboardMarkup(req, res, next) {
    try {
      const ejs = require('ejs');
      const path = require('path');
      const { getAdminCapabilities } = require('../helpers/PermissionHelper');
      const capabilities = await getAdminCapabilities(req.user);
      const html = await ejs.renderFile(
        path.join(__dirname, '../../views/admin/dashboard-fragment.ejs'),
        { isSuperadmin: capabilities.isSuperadmin, activePage: '' },
        { async: true },
      );
      res.type('html').send(html);
    } catch (error) {
      next(error);
    }
  }

  static async completeProfileMeta(req, res, next) {
    try {
      const Department = require('../models/Department');
      const departments = await Department.find({}).select('name').sort({ name: 1 }).lean();
      res.json({ success: true, data: { departments } });
    } catch (error) {
      next(error);
    }
  }

  static async renderPartial(res, view, locals) {
    const ejs = require('ejs');
    const path = require('path');
    const html = await ejs.renderFile(path.join(__dirname, '../../views', view), locals, { async: true });
    res.type('html').send(html);
  }

  static async superSettingsMarkup(req, res, next) {
    try {
      await AppConfigController.renderPartial(res, 'admin/partials/system-settings-tab.ejs', { standalone: true });
    } catch (error) { next(error); }
  }

  static async superSecurityMarkup(req, res, next) {
    try {
      const ejs = require('ejs');
      const path = require('path');
      const file = path.join(__dirname, '../../views/admin/super-security-body.ejs');
      const fs = require('fs');
      if (!fs.existsSync(file)) {
        const full = fs.readFileSync(path.join(__dirname, '../../views/admin/super-security.ejs'), 'utf8');
        const lines = full.split(/\r?\n/);
        const body = lines.slice(31, -15).join('\n');
        fs.writeFileSync(file, body, 'utf8');
      }
      await AppConfigController.renderPartial(res, 'admin/super-security-body.ejs', {});
    } catch (error) { next(error); }
  }

  static async superBackupMarkup(req, res, next) {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(__dirname, '../../views/admin/super-backup-body.ejs');
      if (!fs.existsSync(file)) {
        const full = fs.readFileSync(path.join(__dirname, '../../views/admin/super-backup.ejs'), 'utf8');
        const lines = full.split(/\r?\n/);
        const body = lines.slice(31, -10).join('\n');
        fs.writeFileSync(file, body, 'utf8');
      }
      await AppConfigController.renderPartial(res, 'admin/super-backup-body.ejs', {});
    } catch (error) { next(error); }
  }
}

module.exports = AppConfigController;
