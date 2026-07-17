const mongoose = require('mongoose');

const securityLogSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'login_success',
      'login_failed',
      'account_locked',
      'account_unlocked',
      'super_token_required',
      'super_token_success',
      'super_token_failed',
      'session_idle_timeout',
      'session_invalidated',
      'session_hijack_suspect',
      'logout_success',
      'user_deleted',
      'backup_export',
      'backup_restore',
      'logs_purged',
      'waf_blocked',
    ],
    required: true,
    index: true,
  },
  username: { type: String, default: '', trim: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  role: { type: String, default: '' },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  message: { type: String, default: '' },
  metadata: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now, index: true },
});

securityLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SecurityLog', securityLogSchema);
