const mongoose = require('mongoose');

const userSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  username: {
    type: String,
    trim: true,
    default: null,
    index: true,
  },
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  tokenHash: {
    type: String,
    required: true,
    select: false,
  },
  authSource: {
    type: String,
    enum: ['local', 'ldap'],
    default: 'local',
  },
  status: {
    type: String,
    enum: ['active', 'revoked', 'expired'],
    default: 'active',
    index: true,
  },
  issuedAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  lastActivityAt: {
    type: Date,
    default: Date.now,
  },
  revokedAt: {
    type: Date,
    default: null,
  },
  revokeReason: {
    type: String,
    default: null,
    trim: true,
  },
  ipAddress: {
    type: String,
    default: null,
    trim: true,
  },
  userAgent: {
    type: String,
    default: null,
    trim: true,
  },
});

userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
userSessionSchema.index({ userId: 1, authSource: 1, status: 1 }, { background: true, partialFilterExpression: { userId: { $type: 'objectId' } } });
userSessionSchema.index({ username: 1, authSource: 1, status: 1 }, { background: true, partialFilterExpression: { username: { $type: 'string' } } });
userSessionSchema.index({ sessionId: 1, status: 1 }, { background: true });

module.exports = mongoose.model('UserSession', userSessionSchema);
