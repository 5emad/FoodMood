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
  ldapBaseDn: '',
  ldapBindDn: '',
  ldapUserFilter: '(sAMAccountName={{username}})',
};

function publicSettings(settings) {
  const raw = settings.toObject ? settings.toObject({ getters: false, virtuals: false }) : { ...settings };
  const storedEnc = raw.ldapBindPasswordEnc || '';
  delete raw.ldapBindPasswordEnc;
  return {
    ...raw,
    hasLdapBindPassword: Boolean(storedEnc || process.env.LDAP_BIND_PASSWORD),
    ldapBindPasswordStored: Boolean(storedEnc),
    ldapBindPasswordFromEnv: Boolean(process.env.LDAP_BIND_PASSWORD),
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
  getOrCreateSettings,
  getSettingsLean,
};
