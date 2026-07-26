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
  showFinancialStatementToUsers: {
    type: Boolean,
    default: true,
  },
  organizationSharePercent: {
    type: Number,
    default: 50,
    min: 0,
    max: 100,
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
  enableCapacityLimit: {
    type: Boolean,
    default: true,
  },
  themePrimary: {
    type: String,
    default: '#1B3F8D',
    trim: true,
  },
  themePrimaryLight: {
    type: String,
    default: '#4D73B5',
    trim: true,
  },
  themePrimaryDark: {
    type: String,
    default: '#122A62',
    trim: true,
  },
  themeGradientFrom: {
    type: String,
    default: '#0B1A3D',
    trim: true,
  },
  themeGradientTo: {
    type: String,
    default: '#1B3F8D',
    trim: true,
  },
  /** vazirmatn | yekanbakh */
  uiFont: {
    type: String,
    enum: ['vazirmatn', 'yekanbakh'],
    default: 'vazirmatn',
    trim: true,
  },
  wafEnabled: {
    type: Boolean,
    default: true,
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
  ldapCaCertPem: {
    type: String,
    default: '',
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
  /** Semver written on each boot/update so UI can show version even if package.json path drifts */
  appVersion: {
    type: String,
    default: '',
    trim: true,
  },
  previousAppVersion: {
    type: String,
    default: '',
    trim: true,
  },
  appVersionUpdatedAt: {
    type: Date,
    default: null,
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
