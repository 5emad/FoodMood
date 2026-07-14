const AppSetting = require('../models/AppSetting');

const defaultSettings = {
  key: 'default',
  showPricesToUsers: true,
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
  };
}

async function getOrCreateSettings() {
  return AppSetting.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: defaultSettings },
    { upsert: true, new: true }
  );
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
  getSettingsLean,
};
