const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const { getAdminCapabilities } = require('../helpers/PermissionHelper');
const { getSettingsLean, adminWorkspaceSettings } = require('../services/SettingsService');

const superadminOnly = roleMiddleware(['superadmin']);
const ADMIN_TABS = ['reports', 'weeks', 'orders', 'foods', 'users', 'departments', 'finance', 'guests', 'announcements'];

async function renderDashboard(req, res, next, activePage) {
  try {
    const [capabilities, settings] = await Promise.all([
      getAdminCapabilities(req.user),
      getSettingsLean(),
    ]);
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
}

router.get('/', authMiddleware, roleMiddleware(['admin', 'superadmin']), (req, res) => {
  res.redirect(302, '/admin/reports');
});

router.get('/dashboard', authMiddleware, roleMiddleware(['admin', 'superadmin']), (req, res) => {
  const tab = String(req.query.tab || '');
  if (ADMIN_TABS.includes(tab)) return res.redirect(302, `/admin/${tab}`);
  return res.redirect(302, '/admin/reports');
});

ADMIN_TABS.forEach((tab) => {
  router.get(`/${tab}`, authMiddleware, roleMiddleware(['admin', 'superadmin']), (req, res, next) => {
    renderDashboard(req, res, next, tab);
  });
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
