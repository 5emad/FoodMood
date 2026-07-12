const mongoose = require('mongoose');

const weekSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
  },
  weekNumber: {
    type: Number,
    required: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
  isActive: {
    type: Boolean,
    default: false,
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

weekSchema.pre('validate', function(next) {
  if (!this.name) {
    this.name = `Week ${this.weekNumber}`;
  }
  // Keep status and isActive in sync in both directions.
  this.status = this.isActive ? 'active' : 'inactive';
  next();
});

weekSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Week', weekSchema);
