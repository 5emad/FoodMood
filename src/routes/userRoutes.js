const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const ldapProfileMiddleware = require('../middleware/ldapProfileMiddleware');

router.use(authMiddleware, ldapProfileMiddleware);

// داشبورد کاربر
router.get('/', (_req, res) => {
  res.redirect('/user/dashboard');
});

router.get('/dashboard', (req, res) => {
  res.render('user/dashboard', { user: req.user });
});

module.exports = router;
