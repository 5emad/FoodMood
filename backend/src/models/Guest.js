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
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

guestSchema.pre('save', function saveHook(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Guest', guestSchema);
