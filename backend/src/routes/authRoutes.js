const express = require('express');
const AuthController = require('../controllers/AuthController');
const authMiddleware = require('../middleware/authMiddleware');
const {
  superTokenLimiter,
  registerLimiter,
  captchaLimiter,
  passwordChangeLimiter,
} = require('../middleware/rateLimiter');

const router = express.Router();

router.get('/captcha', captchaLimiter, AuthController.captcha);
router.get('/register/meta', AuthController.registerMeta);
router.post('/register', registerLimiter, AuthController.register);
router.post('/resolve-username', AuthController.resolveUsername);
router.post('/login', AuthController.login);
router.post('/verify-super-token', superTokenLimiter, AuthController.verifySuperToken);
router.post('/logout', AuthController.logout);
router.get('/ping', authMiddleware, AuthController.ping);
router.get('/me', authMiddleware, AuthController.getCurrentUser);
router.patch('/profile', authMiddleware, AuthController.updateProfile);
router.post('/change-password', authMiddleware, passwordChangeLimiter, AuthController.changePassword);
router.post('/set-fullname', authMiddleware, AuthController.setFullName);

module.exports = router;
