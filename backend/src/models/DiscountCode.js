const mongoose = require('mongoose');

/**
 * کد تخفیف پرداخت (سبد خرید / صورتحساب هفتگی و ماهیانه).
 * مخاطب: همه | یک واحد | یک نفر (کلید مالی: userId | ldap:username | guest:id)
 * دوره: هر زمان | یک هفته | یک ماه شمسی — فقط سفارش‌های تحویلی همان دوره تخفیف می‌گیرند.
 */
const discountCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    maxlength: 24,
  },
  title: {
    type: String,
    trim: true,
    default: '',
    maxlength: 120,
  },
  type: {
    type: String,
    enum: ['percent', 'fixed'],
    default: 'percent',
  },
  /** درصد (۱ تا ۱۰۰) یا مبلغ ثابت به تومان */
  value: {
    type: Number,
    required: true,
    min: 1,
  },
  /** سقف تخفیف برای نوع درصدی (تومان) — ۰ = بدون سقف */
  maxDiscount: {
    type: Number,
    default: 0,
    min: 0,
  },
  audience: {
    type: String,
    enum: ['all', 'department', 'person'],
    default: 'all',
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
  },
  departmentName: {
    type: String,
    trim: true,
    default: '',
  },
  personKey: {
    type: String,
    trim: true,
    default: '',
  },
  personLabel: {
    type: String,
    trim: true,
    default: '',
  },
  periodType: {
    type: String,
    enum: ['any', 'week', 'month'],
    default: 'any',
  },
  /** weekId یا YYYY-MM شمسی */
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
  startsAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  /** ۰ = نامحدود */
  maxUses: {
    type: Number,
    default: 0,
    min: 0,
  },
  perPersonLimit: {
    type: Number,
    default: 1,
    min: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

discountCodeSchema.index({ isActive: 1, expiresAt: 1 });

module.exports = mongoose.model('DiscountCode', discountCodeSchema);
