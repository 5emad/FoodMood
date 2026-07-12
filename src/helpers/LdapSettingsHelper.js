const { defaultSettings } = require('../services/SettingsService');

function parseBoolean(value) {
  return value === true || value === 'true' || value === '1';
}

/**
 * Merges saved LDAP settings with request body overrides (admin test/save forms).
 */
function mergeLdapSettings(saved = {}, body = {}) {
  const settings = { ...saved };
  if (body.ldapEnabled !== undefined) settings.ldapEnabled = parseBoolean(body.ldapEnabled);
  if (body.ldapUrl !== undefined) settings.ldapUrl = String(body.ldapUrl || '').trim();
  if (body.ldapSecurity !== undefined) {
    const security = String(body.ldapSecurity || '').trim();
    settings.ldapSecurity = ['ldap', 'ldaps', 'starttls'].includes(security)
      ? security
      : defaultSettings.ldapSecurity;
  }
  if (body.ldapCaCertPath !== undefined) settings.ldapCaCertPath = String(body.ldapCaCertPath || '').trim();
  if (body.ldapBaseDn !== undefined) settings.ldapBaseDn = String(body.ldapBaseDn || '').trim();
  if (body.ldapBindDn !== undefined) settings.ldapBindDn = String(body.ldapBindDn || '').trim();
  if (body.ldapUserFilter !== undefined) {
    settings.ldapUserFilter = String(body.ldapUserFilter || '').trim() || defaultSettings.ldapUserFilter;
  }
  if (typeof body.ldapBindPassword === 'string' && body.ldapBindPassword.length > 0) {
    settings.transientLdapBindPassword = body.ldapBindPassword;
  }
  return settings;
}

function ldapFieldsFromBody(body = {}) {
  const update = {};
  if (body.ldapEnabled !== undefined) update.ldapEnabled = parseBoolean(body.ldapEnabled);
  if (body.ldapUrl !== undefined) update.ldapUrl = String(body.ldapUrl || '').trim();
  if (body.ldapSecurity !== undefined) {
    update.ldapSecurity = ['ldap', 'ldaps', 'starttls'].includes(body.ldapSecurity)
      ? body.ldapSecurity
      : defaultSettings.ldapSecurity;
  }
  if (body.ldapCaCertPath !== undefined) update.ldapCaCertPath = String(body.ldapCaCertPath || '').trim();
  if (body.ldapBaseDn !== undefined) update.ldapBaseDn = String(body.ldapBaseDn || '').trim();
  if (body.ldapBindDn !== undefined) update.ldapBindDn = String(body.ldapBindDn || '').trim();
  if (body.ldapUserFilter !== undefined) {
    update.ldapUserFilter = String(body.ldapUserFilter || '').trim() || defaultSettings.ldapUserFilter;
  }
  return update;
}

module.exports = { mergeLdapSettings, ldapFieldsFromBody, parseBoolean };
