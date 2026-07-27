const mongoose = require('mongoose');
const crypto = require('crypto');

const statementSchema = new mongoose.Schema({
  id: { type: String, required: true },
  text: { type: String, required: true, trim: true, maxlength: 200 },
  sentiment: { type: String, enum: ['positive', 'negative'], required: true },
}, { _id: false });

const surveySchema = new mongoose.Schema({
  kind: {
    type: String,
    enum: ['config', 'response'],
    required: true,
    index: true,
  },
  // config
  isActive: { type: Boolean, default: false },
  activationId: { type: String, default: '', index: true },
  statements: { type: [statementSchema], default: [] },
  updatedBy: { type: String, default: '' },
  // response
  userKey: { type: String, default: '', index: true },
  bestFoodId: { type: String, default: '' },
  bestFoodName: { type: String, default: '' },
  selectedStatementIds: { type: [String], default: [] },
  skipped: { type: Boolean, default: false },
}, {
  collection: 'survey',
  timestamps: true,
});

surveySchema.index(
  { kind: 1, userKey: 1, activationId: 1 },
  {
    unique: true,
    partialFilterExpression: { kind: 'response' },
  },
);

surveySchema.statics.newStatementId = function newStatementId() {
  return crypto.randomBytes(8).toString('hex');
};

surveySchema.statics.newActivationId = function newActivationId() {
  return crypto.randomBytes(12).toString('hex');
};

module.exports = mongoose.model('Survey', surveySchema);
