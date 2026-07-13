const express = require('express');
const multer = require('multer');
const path = require('path');
const AdminController = require('../controllers/AdminController');
const MenuController = require('../controllers/MenuController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const { backupRestoreLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext === '.fzbackup') return cb(null, true);
    cb(new Error('فقط فایل پشتیبان سامانه با پسوند .fzbackup قابل قبول است.'));
  },
});

router.use(authMiddleware, roleMiddleware(['admin', 'superadmin']));

router.get('/dashboard', AdminController.dashboard);
router.get('/reports/months', AdminController.getReportMonths);
router.get('/reports', AdminController.getReports);
router.get('/reports/pdf', AdminController.getReportPdf);
router.get('/settings', roleMiddleware(['superadmin']), AdminController.getSettings);
router.put('/settings', roleMiddleware(['superadmin']), AdminController.updateSettings);
router.post('/settings', roleMiddleware(['superadmin']), AdminController.updateSettings);
router.post('/settings/test-ldap', roleMiddleware(['superadmin']), AdminController.testLdapConnection);
router.get('/system/logs', roleMiddleware(['superadmin']), AdminController.getSystemLogs);
router.get('/security/summary', roleMiddleware(['superadmin']), AdminController.getSecuritySummary);
router.post('/security/users/:id/unlock', roleMiddleware(['superadmin']), AdminController.unlockUser);
router.post('/security/super-token/reset', roleMiddleware(['superadmin']), AdminController.resetOwnSuperToken);

router.get('/users', AdminController.getUsers);
router.post('/users', AdminController.createUser);
router.put('/users/:id', AdminController.updateUser);
router.delete('/users/:id', AdminController.deleteUser);

router.get('/departments', AdminController.getDepartments);
router.post('/departments', AdminController.createDepartment);
router.put('/departments/:id', AdminController.updateDepartment);
router.delete('/departments/:id', AdminController.deleteDepartment);

router.get('/weeks', AdminController.getWeeks);
router.post('/weeks', AdminController.createWeek);
router.post('/weeks/current', AdminController.createCurrentWeek);
router.put('/weeks/:id', AdminController.updateWeek);
router.post('/weeks/:id/activate', AdminController.activateWeek);
router.delete('/weeks/:id', AdminController.deleteWeek);

router.post('/menu-items', MenuController.addItem);
router.put('/menu-items/:id', MenuController.updateItem);
router.delete('/menu-items/:id', MenuController.deleteItem);

router.get('/backup/export', AdminController.exportBackup);
router.post('/backup/restore', backupRestoreLimiter, (req, res, next) => {
  backupUpload.single('backupFile')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'خطا در آپلود فایل پشتیبان' });
    }
    next();
  });
}, AdminController.restoreBackup);

module.exports = router;
