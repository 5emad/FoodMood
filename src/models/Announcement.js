const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title: {
    type: String,
    default: '',
    trim: true,
  },
  body: {
    type: String,
    default: '',
    trim: true,
  },
  titleEnc: {
    type: String,
    default: '',
  },
  bodyEnc: {
    type: String,
    default: '',
  },
  audience: {
    type: String,
    enum: ['all', 'department'],
    default: 'all',
  },
  departmentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  }],
  isActive: {
    type: Boolean,
    default: true,
  },
  expiresAt: {
    type: Date,
    default: null,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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

announcementSchema.index({ isActive: 1, audience: 1, departmentIds: 1, expiresAt: 1 });

announcementSchema.pre('save', function saveHook(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Announcement', announcementSchema);
