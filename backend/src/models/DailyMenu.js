const mongoose = require('mongoose');

const dailyMenuSchema = new mongoose.Schema({
  weekId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Week',
    required: true,
  },
  dayId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Day',
    required: true,
  },
  date: {
    type: Date,
    required: true,
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

dailyMenuSchema.index({ weekId: 1, dayId: 1 }, { unique: true });
dailyMenuSchema.index({ weekId: 1, date: 1 }, { unique: true });

dailyMenuSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('DailyMenu', dailyMenuSchema);
