const mongoose = require('mongoose');

const appSettingSchema = new mongoose.Schema({
  key: {
    type: String,
    default: 'default',
    unique: true,
  },
  showPricesToUsers: {
    type: Boolean,
    default: true,
  },
  organizationName: {
    type: String,
    default: 'سامانه تغذیه',
    trim: true,
  },
  publicUrl: {
    type: String,
    default: '',
    trim: true,
  },
  maxActiveReservations: {
    type: Number,
    default: 0,
    min: 0,
  },
  defaultMenuItemCapacity: {
    type: Number,
    default: 50,
    min: 0,
  },
  themePrimary: {
    type: String,
    default: '#9B6DFF',
    trim: true,
  },
  themePrimaryLight: {
    type: String,
    default: '#C4A8FF',
    trim: true,
  },
  themePrimaryDark: {
    type: String,
    default: '#6C3FD4',
    trim: true,
  },
  themeGradientFrom: {
    type: String,
    default: '#1A0E38',
    trim: true,
  },
  themeGradientTo: {
    type: String,
    default: '#2D1460',
    trim: true,
  },
  ldapEnabled: {
    type: Boolean,
    default: false,
  },
  ldapUrl: {
    type: String,
    default: '',
    trim: true,
  },
  ldapSecurity: {
    type: String,
    enum: ['ldap', 'ldaps', 'starttls'],
    default: 'ldaps',
  },
  ldapCaCertPath: {
    type: String,
    default: '',
    trim: true,
  },
  ldapBaseDn: {
    type: String,
    default: '',
    trim: true,
  },
  ldapBindDn: {
    type: String,
    default: '',
    trim: true,
  },
  ldapBindPasswordEnc: {
    type: String,
    default: '',
    select: false,
  },
  ldapUserFilter: {
    type: String,
    default: '(sAMAccountName={{username}})',
    trim: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

appSettingSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('AppSetting', appSettingSchema);
