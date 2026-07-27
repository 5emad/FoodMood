const mongoose = require('mongoose');

/**
 * Persisted percent discount on a computed finance statement
 * (userKey + week|month + periodKey).
 */
const statementDiscountSchema = new mongoose.Schema({
  userKey: {
    type: String,
    required: true,
    trim: true,
  },
  periodType: {
    type: String,
    enum: ['week', 'month'],
    required: true,
  },
  periodKey: {
    type: String,
    required: true,
    trim: true,
  },
  discountPercent: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  note: {
    type: String,
    trim: true,
    default: '',
    maxlength: 300,
  },
  updatedBy: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

statementDiscountSchema.index(
  { userKey: 1, periodType: 1, periodKey: 1 },
  { unique: true },
);

module.exports = mongoose.model('StatementDiscount', statementDiscountSchema);
