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
  email: {
    type: String,
    default: null,
    trim: true,
    lowercase: true,
  },
  phone: {
    type: String,
    default: null,
    trim: true,
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
  },
  department: {
    type: String,
    default: null,
    trim: true,
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
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
