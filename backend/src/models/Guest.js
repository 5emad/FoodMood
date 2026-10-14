const mongoose = require('mongoose');

const guestSchema = new mongoose.Schema({
  guestCode: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true,
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  guestType: {
    type: String,
    enum: ['permanent', 'temporary'],
    default: 'temporary',
  },
  department: {
    type: String,
    trim: true,
    default: '',
  },
  validUntil: {
    type: Date,
    default: null,
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  createdBy: {
    type: String,
    trim: true,
    default: '',
  },
  /** لینک ورود مستقیم یک‌بارمصرف: فقط هش SHA-256 توکن ذخیره می‌شود */
  magicTokenHash: {
    type: String,
    default: '',
    select: false,
  },
  magicCreatedAt: {
    type: Date,
    default: null,
  },
  magicExpiresAt: {
    type: Date,
    default: null,
  },
  magicUsedAt: {
    type: Date,
    default: null,
  },
  /** با تغییر رمز یا «خروج از همه نشست‌ها» بالا می‌رود تا نشست‌های قبلی باطل شوند */
  linkVersion: {
    type: Number,
    default: 1,
  },
  /** رمز اختیاری مهمان (bcrypt + pepper)؛ خالی = ورود فقط با شناسه از طریق لینک */
  passwordHash: {
    type: String,
    default: '',
    select: false,
  },
  loginAttempts: {
    type: Number,
    default: 0,
    select: false,
  },
  lockUntil: {
    type: Date,
    default: null,
    select: false,
  },
  lastLoginAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

guestSchema.index({ status: 1, createdAt: -1 }, { background: true });
guestSchema.index(
  { magicTokenHash: 1 },
  { partialFilterExpression: { magicTokenHash: { $type: 'string', $gt: '' } } },
);
guestSchema.index({ guestType: 1, status: 1, createdAt: -1 }, { background: true });

guestSchema.pre('save', function saveHook(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Guest', guestSchema);
