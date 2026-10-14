const express = require('express');
const guestAuthMiddleware = require('../middleware/guestAuthMiddleware');
const GuestPortalController = require('../controllers/GuestPortalController');
const MenuController = require('../controllers/MenuController');
const OrderController = require('../controllers/OrderController');
const AnnouncementController = require('../controllers/AnnouncementController');
const { createWafParamsRestoreMiddleware } = require('../middleware/firewtwallPatches');
const { guestLoginLimiter, guestCaptchaLimiter, guestMagicLimiter } = require('../middleware/rateLimiter');
const { mountStatementAndPaymentRoutes } = require('./portalSharedRoutes');

/**
 * پرتال مهمان: /api/guest
 * عمومی: link, login, logout — بقیه با نشست مهمان (req.user = بازیگر مهمان)
 */
const router = express.Router();
const restoreIds = createWafParamsRestoreMiddleware();
router.param('id', (req, res, next) => restoreIds(req, res, next));
router.param('weekId', (req, res, next) => restoreIds(req, res, next));

router.get('/captcha', guestCaptchaLimiter, GuestPortalController.captcha);
router.get('/session', GuestPortalController.session);
router.post('/login', guestLoginLimiter, GuestPortalController.login);
router.post('/magic', guestMagicLimiter, GuestPortalController.magic);
router.post('/logout', GuestPortalController.logout);

router.use(guestAuthMiddleware);

router.get('/me', GuestPortalController.me);
router.get('/bootstrap', GuestPortalController.bootstrap);
router.get('/announcements', AnnouncementController.getActive);

router.get('/menu/active-weeks', MenuController.listActiveWeeks);
router.get('/menu/active', MenuController.getWeeklyMenu);
router.get('/menu/weeks/:weekId', MenuController.getWeeklyMenu);

router.get('/orders', OrderController.getUserOrders);
router.post('/orders', GuestPortalController.createOrder);
router.post('/orders/:id/cancel', OrderController.cancel);

mountStatementAndPaymentRoutes(router);

module.exports = router;
