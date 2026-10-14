const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const ldapProfileMiddleware = require('../middleware/ldapProfileMiddleware');
const UserStatementController = require('../controllers/UserStatementController');
const PaymentController = require('../controllers/PaymentController');
const { RECEIPT_DIR } = require('../services/PaymentService');
const { createWafParamsRestoreMiddleware } = require('../middleware/firewtwallPatches');
const { createImageDiskUpload, assertUploadedImageMagic } = require('../helpers/ImageUploadHelper');
const { paymentCreateLimiter } = require('../middleware/rateLimiter');

const receiptUpload = createImageDiskUpload({ destDir: RECEIPT_DIR, maxSizeMb: 5, filenamePrefix: 'receipt' });

function uploadReceipt(req, res, next) {
  receiptUpload.single('receipt')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'حجم تصویر رسید نباید بیشتر از ۵ مگابایت باشد'
        : (err.message || 'خطا در بارگذاری تصویر رسید');
      return res.status(400).json({ success: false, message });
    }
    return next();
  });
}

const router = express.Router();
const restoreIds = createWafParamsRestoreMiddleware();
router.param('id', (req, res, next) => restoreIds(req, res, next));

router.use(authMiddleware, ldapProfileMiddleware);

router.get('/statement/config', UserStatementController.getConfig);
router.get('/statement/list', UserStatementController.getList);
router.get('/statement/weeks', UserStatementController.getWeeks);
router.get('/statement/months', UserStatementController.getMonths);
router.get('/statement', UserStatementController.getStatement);

router.get('/payments/config', PaymentController.getConfig);
router.get('/payments/cart', PaymentController.getCart);
router.get('/payments/quote', PaymentController.getQuote);
router.post('/payments/card', paymentCreateLimiter, uploadReceipt, assertUploadedImageMagic, PaymentController.payByCard);
router.post('/payments/online', paymentCreateLimiter, PaymentController.payOnline);
router.get('/payments', PaymentController.listMine);
router.get('/payments/:id', PaymentController.getMine);
router.get('/payments/:id/receipt', PaymentController.getMyReceipt);

module.exports = router;
