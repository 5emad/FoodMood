const express = require('express');
const multer = require('multer');
const path = require('path');
const AdminController = require('../controllers/AdminController');
const AnnouncementController = require('../controllers/AnnouncementController');
const GuestController = require('../controllers/GuestController');
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

const sslUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

router.use(authMiddleware, roleMiddleware(['admin', 'superadmin']));

router.get('/dashboard', AdminController.dashboard);
router.get('/finance-settings', AdminController.getFinanceSettings);
router.put('/finance-settings', AdminController.updateFinanceSettings);
router.get('/finance-statements', AdminController.getFinanceStatements);
router.get('/finance-statements/months', AdminController.getFinanceMonths);
router.get('/finance-statements/pdf', AdminController.getFinanceStatementPdf);
router.get('/workspace-settings', AdminController.getWorkspaceSettings);
router.get('/reports/access', AdminController.getReportsAccess);
router.get('/reports/months', AdminController.getReportMonths);
router.get('/reports/supplier', AdminController.getSupplierReport);
router.get('/reports/supplier/pdf', AdminController.getSupplierReportPdf);
router.get('/reports', AdminController.getReports);
router.get('/reports/pdf', AdminController.getReportPdf);
router.get('/settings', roleMiddleware(['superadmin']), AdminController.getSettings);
router.put('/settings', roleMiddleware(['superadmin']), AdminController.updateSettings);
router.post('/settings', roleMiddleware(['superadmin']), AdminController.updateSettings);
router.post('/settings/test-ldap', roleMiddleware(['superadmin']), AdminController.testLdapConnection);
router.get('/settings/ssl-status', roleMiddleware(['superadmin']), AdminController.getSslStatus);
router.post('/settings/ssl-certificate', roleMiddleware(['superadmin']), (req, res, next) => {
  sslUpload.fields([
    { name: 'certificate', maxCount: 1 },
    { name: 'privateKey', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'حجم فایل گواهی بیش از حد مجاز است'
        : 'خطا در آپلود فایل گواهی';
      return res.status(400).json({ success: false, message });
    }
    next();
  });
}, AdminController.uploadSslCertificate);
router.get('/system/logs', roleMiddleware(['superadmin']), AdminController.getSystemLogs);
router.get('/security/summary', roleMiddleware(['superadmin']), AdminController.getSecuritySummary);
router.post('/security/users/:id/unlock', roleMiddleware(['superadmin']), AdminController.unlockUser);
router.post('/security/super-token/reset', roleMiddleware(['superadmin']), AdminController.resetOwnSuperToken);

router.get('/users', AdminController.getUsers);
router.post('/users', AdminController.createUser);
router.put('/users/:id', AdminController.updateUser);
router.delete('/users/:id', AdminController.deleteUser);

router.get('/guests', GuestController.list);
router.post('/guests', GuestController.create);
router.put('/guests/:id', GuestController.update);
router.delete('/guests/:id', GuestController.remove);
router.post('/guests/:id/reserve', GuestController.reserve);
router.get('/guests/:id/reservations', GuestController.reservations);

router.get('/announcements', AnnouncementController.list);
router.post('/announcements', AnnouncementController.create);
router.put('/announcements/:id', AnnouncementController.update);
router.delete('/announcements/:id', AnnouncementController.remove);

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

router.get('/backup/export', roleMiddleware(['superadmin']), AdminController.exportBackup);
router.post('/backup/restore', roleMiddleware(['superadmin']), backupRestoreLimiter, (req, res, next) => {
  backupUpload.single('backupFile')(req, res, (err) => {
    if (err) {
      let message = 'خطا در آپلود فایل پشتیبان';
      if (err.code === 'LIMIT_FILE_SIZE') message = 'حجم فایل پشتیبان بیش از حد مجاز است';
      else if (/fzbackup/i.test(String(err.message || ''))) message = err.message;
      return res.status(400).json({ success: false, message });
    }
    next();
  });
}, AdminController.restoreBackup);

module.exports = router;
