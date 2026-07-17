const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const { getAdminCapabilities } = require('../helpers/PermissionHelper');
const { getSettingsLean, adminWorkspaceSettings } = require('../services/SettingsService');

const superadminOnly = roleMiddleware(['superadmin']);

// داشبورد مدیریت
router.get('/', authMiddleware, roleMiddleware(['admin', 'superadmin']), (req, res) => {
  res.redirect('/admin/dashboard');
});

router.get('/dashboard', authMiddleware, roleMiddleware(['admin', 'superadmin']), async (req, res, next) => {
  try {
    const [capabilities, settings] = await Promise.all([
      getAdminCapabilities(req.user),
      getSettingsLean(),
    ]);
    const tab = String(req.query.tab || '');
    const validTabs = Object.entries(capabilities.tabs || {})
      .filter(([, allowed]) => allowed)
      .map(([name]) => name);
    const activePage = validTabs.includes(tab) ? tab : 'reports';
    res.render('admin/dashboard', {
      user: req.user,
      isSuperadmin: capabilities.isSuperadmin,
      activePage,
      reportsAccess: capabilities.reportsAccess,
      capabilities,
      workspaceSettings: adminWorkspaceSettings(settings),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/super/settings', authMiddleware, superadminOnly, (req, res) => {
  res.render('admin/super-settings', { user: req.user, isSuperadmin: true });
});

router.get('/super/security', authMiddleware, superadminOnly, (req, res) => {
  res.render('admin/super-security', { user: req.user, isSuperadmin: true });
});

router.get('/super/backup', authMiddleware, superadminOnly, (req, res) => {
  res.render('admin/super-backup', { user: req.user, isSuperadmin: true });
});

module.exports = router;
