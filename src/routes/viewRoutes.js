const express        = require('express');
const ViewController = require('../controllers/ViewController');
const User           = require('../models/User');
const authMiddleware      = require('../middleware/authMiddleware');
const ldapProfileMiddleware = require('../middleware/ldapProfileMiddleware');
const { needsProfileSetup } = require('../helpers/LdapProfileHelper');
const { loginLimiter }    = require('../middleware/rateLimiter');

const router = express.Router();

router.get('/', (_req, res) => res.redirect('/login'));

router.get('/login', ViewController.renderLogin);

// HTML form login for local-admin accounts (same lockout logic as API)
router.post('/login', loginLimiter, ViewController.login);

router.get('/register', (_req, res) => res.redirect('/login?register=disabled'));

router.get('/complete-profile', authMiddleware, async (req, res, next) => {
  try {
    if (req.user?.authSource === 'ldap') {
      if (!(await needsProfileSetup(req.user.username))) {
        return res.redirect('/user/dashboard');
      }
    } else {
      const user = await User.findById(req.user.id).select('mustSetFullName role').lean();
      if (!user?.mustSetFullName) {
        const target = ['admin', 'superadmin'].includes(user?.role) ? '/admin/dashboard' : '/user/dashboard';
        return res.redirect(target);
      }
    }
    return res.render('auth/complete-profile', { user: req.user });
  } catch (error) {
    return next(error);
  }
});

router.get('/foods', authMiddleware, ldapProfileMiddleware, (_req, res) => res.render('foods', {}));

router.get('/logout', ViewController.logout);

module.exports = router;
