const UserStatementController = require('../controllers/UserStatementController');
const PaymentController = require('../controllers/PaymentController');
const receiptUpload = require('../middleware/receiptUpload');
const { paymentCreateLimiter, discountCheckLimiter } = require('../middleware/rateLimiter');

/**
 * مسیرهای صورتحساب و پرداخت — مشترک بین پرتال کاربران (/api/user) و پرتال مهمان (/api/guest).
 * کنترلرها با req.user کار می‌کنند (کاربر واقعی یا بازیگر مهمان).
 */
function mountStatementAndPaymentRoutes(router) {
  router.get('/statement/config', UserStatementController.getConfig);
  router.get('/statement/list', UserStatementController.getList);
  router.get('/statement/weeks', UserStatementController.getWeeks);
  router.get('/statement/months', UserStatementController.getMonths);
  router.get('/statement', UserStatementController.getStatement);

  router.get('/payments/config', PaymentController.getConfig);
  router.get('/payments/cart', PaymentController.getCart);
  router.get('/payments/quote', PaymentController.getQuote);
  router.post('/payments/card', paymentCreateLimiter, ...receiptUpload, PaymentController.payByCard);
  router.post('/payments/online', paymentCreateLimiter, PaymentController.payOnline);
  router.post('/payments/discount/check', discountCheckLimiter, PaymentController.checkDiscount);
  router.post('/payments/discount/pay', paymentCreateLimiter, PaymentController.payWithDiscount);
  router.get('/payments', PaymentController.listMine);
  router.get('/payments/:id', PaymentController.getMine);
  router.get('/payments/:id/receipt', PaymentController.getMyReceipt);
  return router;
}

module.exports = { mountStatementAndPaymentRoutes };
