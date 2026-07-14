const mongoose = require('mongoose');

const ldapProfileSchema = new mongoose.Schema({
  ldapUsername: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  department: {
    type: String,
    default: null,
    trim: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

ldapProfileSchema.pre('save', function saveTimestamp(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('LdapProfile', ldapProfileSchema);
