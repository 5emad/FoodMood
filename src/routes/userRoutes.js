const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');

// داشبورد کاربر
router.get('/', authMiddleware, (req, res) => {
  res.redirect('/user/dashboard');
});

router.get('/dashboard', authMiddleware, (req, res) => {
  res.render('user/dashboard', { user: req.user });
});

module.exports = router;
