const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const { getReportsAccessForUser } = require('../helpers/ReportsAccessHelper');

// داشبورد مدیریت
router.get('/', authMiddleware, roleMiddleware(['admin', 'superadmin']), (req, res) => {
  res.redirect('/admin/dashboard');
});

router.get('/dashboard', authMiddleware, roleMiddleware(['admin', 'superadmin']), async (req, res, next) => {
  try {
    const reportsAccess = await getReportsAccessForUser(req.user);
    res.render('admin/dashboard', { user: req.user, reportsAccess });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
