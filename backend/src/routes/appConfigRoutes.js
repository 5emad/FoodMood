const express = require('express');
const AppConfigController = require('../controllers/AppConfigController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const ldapProfileMiddleware = require('../middleware/ldapProfileMiddleware');
const ensureDbMiddleware = require('../middleware/ensureDbMiddleware');

const router = express.Router();

router.get('/public', AppConfigController.publicConfig);
router.get('/user/bootstrap', authMiddleware, ldapProfileMiddleware, ensureDbMiddleware, AppConfigController.userBootstrap);
router.get('/user/portal-slider', authMiddleware, ldapProfileMiddleware, ensureDbMiddleware, AppConfigController.getPortalSlider);
router.get('/user/complete-profile-meta', authMiddleware, AppConfigController.completeProfileMeta);
router.get('/admin/bootstrap', authMiddleware, roleMiddleware(['admin', 'superadmin']), ensureDbMiddleware, AppConfigController.adminBootstrap);
router.get('/admin/dashboard-markup', authMiddleware, roleMiddleware(['admin', 'superadmin']), ensureDbMiddleware, AppConfigController.adminDashboardMarkup);
router.get('/admin/super/settings-markup', authMiddleware, roleMiddleware(['superadmin']), ensureDbMiddleware, AppConfigController.superSettingsMarkup);
router.get('/admin/super/security-markup', authMiddleware, roleMiddleware(['superadmin']), ensureDbMiddleware, AppConfigController.superSecurityMarkup);
router.get('/admin/super/backup-markup', authMiddleware, roleMiddleware(['superadmin']), ensureDbMiddleware, AppConfigController.superBackupMarkup);

module.exports = router;
