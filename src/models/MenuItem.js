const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  dailyMenuId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DailyMenu',
    required: true,
  },
  foodId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Food',
    required: true,
  },
  maxCapacity: {
    type: Number,
    default: 0,
    min: 0,
  },
  customPrice: {
    type: Number,
    default: null,
  },
  isAvailable: {
    type: Boolean,
    default: true,
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

menuItemSchema.index({ dailyMenuId: 1, foodId: 1 }, { unique: true });

menuItemSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('MenuItem', menuItemSchema);
