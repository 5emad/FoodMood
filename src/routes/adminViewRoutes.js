const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// داشبورد مدیریت
router.get('/', authMiddleware, roleMiddleware(['admin', 'superadmin']), (req, res) => {
  res.redirect('/admin/dashboard');
});

router.get('/dashboard', authMiddleware, roleMiddleware(['admin', 'superadmin']), (req, res) => {
  res.render('admin/dashboard', { user: req.user });
});

module.exports = router;
