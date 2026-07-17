const mongoose = require('mongoose');

function optionalString(value) {
  if (Array.isArray(value)) value = value.find((item) => typeof item === 'string');
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
    set: optionalString,
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    select: false,
  },
  phone: {
    type: String,
    trim: true,
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'superadmin'],
    default: 'user',
  },
  superTokenHash: {
    type: String,
    default: '',
    select: false,
  },
  superTokenCreatedAt: {
    type: Date,
    default: null,
  },
  superTokenLastUsedAt: {
    type: Date,
    default: null,
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
  mustChangePassword: {
    type: Boolean,
    default: false,
  },
  mustSetFullName: {
    type: Boolean,
    default: false,
  },
  ldapUser: {
    type: Boolean,
    default: false,
  },
  // Single-session enforcement: invalidated whenever a new login occurs
  activeSessionId: {
    type: String,
    default: null,
  },
  // Brute-force protection
  loginAttempts: {
    type: Number,
    default: 0,
  },
  lockUntil: {
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

userSchema.virtual('isLocked').get(function () {
  return this.lockUntil && this.lockUntil > Date.now();
});

userSchema.pre('validate', function (next) {
  if (!this.fullName) this.fullName = this.username;
  next();
});

userSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('User', userSchema);
