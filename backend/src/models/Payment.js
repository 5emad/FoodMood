const mongoose = require('mongoose');
const Counter = require('./Counter');

/**
 * سهم هر سفارش از یک پرداخت.
 * دفتر پرداخت در سطح سفارش نگه داشته می‌شود تا پرداخت هفتگی خودکار از صورتحساب ماهیانه کم شود.
 */
const paymentItemSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
  },
  /** کلید مالک سفارش: ldap:username | userId */
  ownerKey: {
    type: String,
    trim: true,
    required: true,
  },
  /** تاریخ گزارش سفارش (تاریخ روز منو) */
  reportDate: {
    type: Date,
    required: true,
  },
  orderNumber: {
    type: Number,
    default: null,
  },
  foodName: {
    type: String,
    trim: true,
    default: '',
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  paymentNumber: {
    type: Number,
    unique: true,
    sparse: true,
  },
  userKey: {
    type: String,
    trim: true,
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  ldapUsername: {
    type: String,
    trim: true,
    default: null,
  },
  payerUsername: {
    type: String,
    trim: true,
    default: '',
  },
  payerName: {
    type: String,
    trim: true,
    default: '',
  },
  payerDepartment: {
    type: String,
    trim: true,
    default: '',
  },
  /** cart = سبد خرید بعد از رزرو | week | month = صورتحساب */
  scope: {
    type: String,
    enum: ['cart', 'week', 'month'],
    required: true,
  },
  periodKey: {
    type: String,
    trim: true,
    default: '',
  },
  periodLabel: {
    type: String,
    trim: true,
    default: '',
  },
  statementNumber: {
    type: String,
    trim: true,
    default: '',
  },
  /** مبلغ پرداختی (پس از تخفیف) به تومان */
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  /** مبلغ قبل از کد تخفیف (= جمع سهم سفارش‌ها) */
  grossAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  discountCodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DiscountCode',
    default: null,
  },
  discountCode: {
    type: String,
    trim: true,
    default: '',
  },
  discountAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  /** discount = کل مبلغ با کد تخفیف پوشش داده شد (بدون پرداخت) */
  method: {
    type: String,
    enum: ['card', 'bale', 'gateway', 'discount'],
    required: true,
  },
  /** card | bale | zarinpal | zibal */
  provider: {
    type: String,
    trim: true,
    default: '',
  },
  sandbox: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    enum: ['initiated', 'review', 'paid', 'rejected', 'failed', 'cancelled'],
    default: 'initiated',
    index: true,
  },
  items: [paymentItemSchema],
  /** کارت به کارت */
  receiptFile: {
    type: String,
    default: '',
  },
  trackingCode: {
    type: String,
    trim: true,
    default: '',
    maxlength: 64,
  },
  payerNote: {
    type: String,
    trim: true,
    default: '',
    maxlength: 300,
  },
  /** درگاه: Authority / trackId — بله: payload */
  gatewayRef: {
    type: String,
    trim: true,
    default: '',
  },
  /** کد پیگیری نهایی بانک / شناسه تراکنش بله */
  referenceId: {
    type: String,
    trim: true,
    default: '',
  },
  cardPan: {
    type: String,
    trim: true,
    default: '',
  },
  invoiceLink: {
    type: String,
    trim: true,
    default: '',
  },
  /** توکن تصادفی برای صفحه‌های پرداخت بدون نشست (پیش‌فاکتور بله، شبیه‌ساز، نتیجه) */
  viewToken: {
    type: String,
    default: '',
    select: false,
  },
  failureReason: {
    type: String,
    trim: true,
    default: '',
  },
  reviewedBy: {
    type: String,
    trim: true,
    default: '',
  },
  reviewedAt: {
    type: Date,
    default: null,
  },
  reviewNote: {
    type: String,
    trim: true,
    default: '',
    maxlength: 300,
  },
  paidAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ userKey: 1, createdAt: -1 });
paymentSchema.index({ 'items.orderId': 1, status: 1 });
paymentSchema.index({ 'items.ownerKey': 1, 'items.reportDate': 1, status: 1 });
paymentSchema.index({ provider: 1, gatewayRef: 1 });
paymentSchema.index({ discountCodeId: 1, status: 1, userKey: 1 }, { partialFilterExpression: { discountCodeId: { $type: 'objectId' } } });
// گزارش مالی: پرداخت‌های تاییدشده در بازه تاریخ (بدون فیلتر کاربر)
paymentSchema.index({ status: 1, 'items.reportDate': 1 });

paymentSchema.pre('validate', async function assignNumber(next) {
  try {
    if (!this.isNew || this.paymentNumber) return next();
    await Counter.updateOne(
      { _id: 'paymentNumber' },
      { $setOnInsert: { seq: 1000 } },
      { upsert: true },
    );
    const counter = await Counter.findOneAndUpdate(
      { _id: 'paymentNumber' },
      { $inc: { seq: 1 } },
      { new: true },
    );
    this.paymentNumber = counter.seq;
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model('Payment', paymentSchema);
