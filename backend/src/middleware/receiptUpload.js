const { RECEIPT_DIR } = require('../services/PaymentService');
const { createImageDiskUpload, assertUploadedImageMagic } = require('../helpers/ImageUploadHelper');

const receiptUpload = createImageDiskUpload({ destDir: RECEIPT_DIR, maxSizeMb: 5, filenamePrefix: 'receipt' });

/** بارگذاری تصویر رسید کارت به کارت (کاربر و مهمان) + بررسی امضای فایل */
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

module.exports = [uploadReceipt, assertUploadedImageMagic];
