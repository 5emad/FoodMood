const AppSetting = require('../models/AppSetting');

const defaultSettings = {
  key: 'default',
  showPricesToUsers: true,
  showFinancialStatementToUsers: true,
  organizationSharePercent: 50,
  organizationName: 'سامانه تغذیه',
  publicUrl: '',
  maxActiveReservations: 0,
  defaultMenuItemCapacity: 20,
  themePrimary: '#9B6DFF',
  themePrimaryLight: '#C4A8FF',
  themePrimaryDark: '#6C3FD4',
  themeGradientFrom: '#1A0E38',
  themeGradientTo: '#2D1460',
  ldapEnabled: false,
  ldapUrl: '',
  ldapSecurity: 'ldaps',
  ldapCaCertPath: '',
  ldapCaCertPem: '',
  ldapBaseDn: '',
  ldapBindDn: '',
  ldapUserFilter: '(sAMAccountName={{username}})',
};

function publicSettings(settings) {
  const raw = settings.toObject ? settings.toObject({ getters: false, virtuals: false }) : { ...settings };
  const storedEnc = raw.ldapBindPasswordEnc || '';
  const caPem = raw.ldapCaCertPem || '';
  delete raw.ldapBindPasswordEnc;
  delete raw.ldapCaCertPem;
  return {
    ...raw,
    hasLdapBindPassword: Boolean(storedEnc || process.env.LDAP_BIND_PASSWORD),
    ldapBindPasswordStored: Boolean(storedEnc),
    ldapBindPasswordFromEnv: Boolean(process.env.LDAP_BIND_PASSWORD),
    hasLdapCaCert: Boolean(caPem || raw.ldapCaCertPath),
  };
}

/** Safe subset for regular admin dashboard — no LDAP, URLs, or secrets */
function adminWorkspaceSettings(settings) {
  const raw = settings && settings.toObject
    ? settings.toObject({ getters: false, virtuals: false })
    : { ...(settings || {}) };
  return {
    organizationName: raw.organizationName || 'سامانه تغذیه',
    defaultMenuItemCapacity: Number(raw.defaultMenuItemCapacity ?? 20),
    showPricesToUsers: raw.showPricesToUsers !== false,
    showFinancialStatementToUsers: raw.showFinancialStatementToUsers !== false,
    organizationSharePercent: Math.min(100, Math.max(0, Number(raw.organizationSharePercent) || 0)),
  };
}

async function getOrCreateSettings() {
  let settings = await AppSetting.findOne({ key: 'default' }).select('+ldapBindPasswordEnc');
  if (settings) return settings;

  try {
    settings = await AppSetting.create({ ...defaultSettings, key: 'default' });
    return settings;
  } catch (error) {
    // Concurrent create race
    if (Number(error?.code) !== 11000) throw error;
  }

  settings = await AppSetting.findOne({ key: 'default' }).select('+ldapBindPasswordEnc');
  if (!settings) throw new Error('امکان ایجاد تنظیمات سامانه وجود ندارد');
  return settings;
}

/**
 * Apply settings fields with a plain $set only.
 * Avoids Mongo conflict from combining $set + $setOnInsert on the same paths.
 */
async function updateAppSettings(fields = {}) {
  await getOrCreateSettings();
  const update = { ...fields, updatedAt: new Date() };
  const settings = await AppSetting.findOneAndUpdate(
    { key: 'default' },
    { $set: update },
    { new: true },
  ).select('+ldapBindPasswordEnc');
  if (!settings) throw new Error('تنظیمات سامانه یافت نشد');
  return settings;
}

async function getSettingsLean() {
  const settings = await AppSetting.findOne({ key: 'default' }).select('+ldapBindPasswordEnc').lean();
  return settings || { ...defaultSettings };
}

module.exports = {
  defaultSettings,
  publicSettings,
  adminWorkspaceSettings,
  getOrCreateSettings,
  updateAppSettings,
  getSettingsLean,
};
