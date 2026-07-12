const express        = require('express');
const ViewController = require('../controllers/ViewController');
const authMiddleware      = require('../middleware/authMiddleware');
const { loginLimiter }    = require('../middleware/rateLimiter');

const router = express.Router();

router.get('/', (_req, res) => res.redirect('/login'));

router.get('/login', ViewController.renderLogin);

// HTML form login for local-admin accounts (same lockout logic as API)
router.post('/login', loginLimiter, ViewController.login);

router.get('/register', (_req, res) => res.redirect('/login?register=disabled'));

router.get('/complete-profile', authMiddleware, (req, res) => {
  res.render('auth/complete-profile', { user: req.user });
});

router.get('/foods', authMiddleware, (_req, res) => res.render('foods', {}));

router.get('/logout', ViewController.logout);

module.exports = router;
