const express = require('express');
const AuthController = require('../controllers/AuthController');
const authMiddleware = require('../middleware/authMiddleware');
const { superTokenLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.post('/verify-super-token', superTokenLimiter, AuthController.verifySuperToken);
router.post('/logout', AuthController.logout);
router.get('/ping', authMiddleware, AuthController.ping);
router.get('/me', authMiddleware, AuthController.getCurrentUser);
router.post('/change-password', authMiddleware, AuthController.changePassword);
router.post('/set-fullname', authMiddleware, AuthController.setFullName);

module.exports = router;
