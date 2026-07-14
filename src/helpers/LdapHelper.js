let Client;
try { ({ Client } = require('ldapts')); } catch { Client = null; }
const fs = require('fs');
const { resolveLdapBindPassword } = require('./SecurityHelper');

function allowedHosts() {
  return process.env.LDAP_ALLOWED_HOSTS
    ? process.env.LDAP_ALLOWED_HOSTS.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)
    : [];
}

function ldapConfig(settings = {}) {
  const bindPassword = resolveLdapBindPassword({
    transientPassword: settings.transientLdapBindPassword,
    storedEnc: settings.ldapBindPasswordEnc,
    envValue: process.env.LDAP_BIND_PASSWORD,
  });
  return {
    enabled:     settings.ldapEnabled ?? Boolean(process.env.LDAP_URL),
    url:         settings.ldapUrl     || process.env.LDAP_URL    || '',
    security:    settings.ldapSecurity|| process.env.LDAP_SECURITY|| 'ldaps',
    caCertPath:  settings.ldapCaCertPath || process.env.LDAP_CA_CERT_PATH || '',
    caCertPem:   settings.ldapCaCertPem || '',
    baseDn:      settings.ldapBaseDn  || process.env.LDAP_BASE_DN || 'DC=company,DC=local',
    bindDn:      settings.ldapBindDn  || process.env.LDAP_BIND_DN || '',
    bindPassword,
    userFilter:  settings.ldapUserFilter || process.env.LDAP_USER_FILTER || '(sAMAccountName={{username}})',
  };
}

function isEnabled(settings = {}) {
  const cfg = ldapConfig(settings);
  return Boolean(Client && cfg.enabled && validateConfig(cfg).valid);
}

function validateConfig(cfg) {
  let parsed;
  try {
    parsed = new URL(cfg.url);
  } catch {
    return { valid: false, message: 'LDAP URL معتبر نیست', status: 'bad_url' };
  }

  const security = String(cfg.security || '').toLowerCase();
  if (!['ldaps', 'starttls', 'ldap'].includes(security)) {
    return { valid: false, message: 'نوع اتصال LDAP معتبر نیست', status: 'bad_security' };
  }
  if (security === 'ldaps' && parsed.protocol !== 'ldaps:') {
    return { valid: false, message: 'برای LDAPS آدرس باید با ldaps:// شروع شود', status: 'bad_protocol' };
  }
  if (security === 'starttls' && parsed.protocol !== 'ldap:') {
    return { valid: false, message: 'برای StartTLS آدرس باید با ldap:// شروع شود', status: 'bad_protocol' };
  }
  if (security === 'ldap' && parsed.protocol !== 'ldap:') {
    return { valid: false, message: 'برای LDAP ساده آدرس باید با ldap:// شروع شود', status: 'bad_protocol' };
  }

  const hosts = allowedHosts();
  if (hosts.length && !hosts.includes(parsed.hostname.toLowerCase())) {
    return { valid: false, message: 'LDAP host در فهرست مجاز نیست', status: 'host_not_allowed' };
  }

  return { valid: true, hostname: parsed.hostname };
}

function tlsOptions(cfg, hostname) {
  const opts = {
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    servername: hostname,
  };
  const pem = String(cfg.caCertPem || '').trim();
  if (pem.includes('BEGIN CERTIFICATE')) {
    opts.ca = [pem];
  } else if (cfg.caCertPath && fs.existsSync(cfg.caCertPath)) {
    opts.ca = [fs.readFileSync(cfg.caCertPath)];
  }
  return opts;
}

function classifyConnectionError(err, cfg) {
  const msg = String(err.message || 'خطا در اتصال');
  const lower = msg.toLowerCase();

  if (msg.includes('00002028') || lower.includes('requires binds to turn on integrity checking')) {
    return {
      success: false,
      message: 'سرور Active Directory bind ساده روی LDAP را نمی‌پذیرد و LDAP signing/integrity یا SSL/TLS می‌خواهد. LDAPS/StartTLS را روی DC فعال کنید یا تنظیمات LDAP را با گواهی معتبر انجام دهید.',
      status: 'ldap_signing_required',
    };
  }
  if (msg.includes('ECONNRESET')) {
    const hint = cfg.security === 'ldaps'
      ? 'احتمالا LDAPS روی پورت 636 این سرور فعال نیست یا TLS handshake توسط سرور قطع می‌شود.'
      : 'احتمالا سرور اتصال غیر TLS را قطع می‌کند یا LDAP signing اجباری است.';
    return { success: false, message: `${hint} (${cfg.url})`, status: 'connection_reset' };
  }
  if (msg.includes('ECONNREFUSED')) return { success: false, message: `سرور LDAP پاسخ نمی‌دهد (${cfg.url})`, status: 'refused' };
  if (msg.includes('ETIMEDOUT') || lower.includes('timeout')) return { success: false, message: 'اتصال timeout شد', status: 'timeout' };
  if (lower.includes('invalid credentials')) return { success: false, message: 'نام کاربری یا رمز Bind اشتباه است', status: 'auth_error' };
  if (lower.includes('certificate') || msg.includes('SSL') || msg.includes('TLS')) return { success: false, message: `خطای SSL/TLS: ${msg}`, status: 'tls_error' };
  return { success: false, message: msg, status: 'error' };
}

function createClient(cfg) {
  const validation = validateConfig(cfg);
  if (!validation.valid) throw new Error(validation.message);
  const opts = {
    url:            cfg.url,
    timeout:        5000,
    connectTimeout: 5000,
  };
  if (String(cfg.security || '').toLowerCase() !== 'ldap') {
    opts.tlsOptions = tlsOptions(cfg, validation.hostname);
  }
  return new Client(opts);
}

async function upgradeToTls(client, cfg) {
  if (cfg.security !== 'starttls') return; // ldaps uses TLS from the start; ldap uses no TLS
  if (typeof client.startTLS !== 'function') throw new Error('LDAP client does not support StartTLS');
  const validation = validateConfig(cfg);
  if (!validation.valid) throw new Error(validation.message);
  await client.startTLS(tlsOptions(cfg, validation.hostname));
}

// RFC 4515 / 4516 escape for filter values
function escapeFilterValue(value) {
  return String(value)
    .replace(/\\/g, '\\5c')
    .replace(/\*/g,  '\\2a')
    .replace(/\(/g,  '\\28')
    .replace(/\)/g,  '\\29')
    .replace(/\0/g,  '\\00');
}

function buildFilter(template, username) {
  if (!template.includes('{{username}}')) {
    throw new Error('LDAP_USER_FILTER باید شامل {{username}} باشد');
  }
  return template.replace('{{username}}', escapeFilterValue(username));
}

/**
 * Authenticate user via LDAP.
 * Returns user attributes on success, null on auth failure, throws on config errors.
 */
async function authenticate(username, password, settings = {}) {
  const cfg = ldapConfig(settings);
  const validation = validateConfig(cfg);
  if (!Client || !cfg.enabled || !validation.valid) return null;

  // Reject empty passwords (some LDAP servers allow unauthenticated bind with empty password)
  if (!password) return null;

  const svcClient = createClient(cfg);
  try {
    await upgradeToTls(svcClient, cfg);

    if (cfg.bindDn) {
      await svcClient.bind(cfg.bindDn, cfg.bindPassword);
    }

    const filter = buildFilter(cfg.userFilter, username);
    const { searchEntries } = await svcClient.search(cfg.baseDn, {
      scope:      'sub',
      filter,
      attributes: ['sAMAccountName', 'cn', 'displayName', 'mail', 'department', 'dn'],
      sizeLimit:  2,
    });

    if (!searchEntries.length) return null;

    const entry  = searchEntries[0];
    const userDn = entry.dn;

    // Bind as the user to verify password
    const userClient = createClient(cfg);
    try {
      await upgradeToTls(userClient, cfg);
      await userClient.bind(userDn, password);
      return {
        username:    entry.sAMAccountName || username,
        displayName: entry.displayName    || entry.cn || username,
        email:       entry.mail           || null,
        department:  entry.department     || null,
      };
    } catch {
      return null; // wrong password
    } finally {
      await userClient.unbind().catch(() => {});
    }
  } catch (err) {
    if (err.message?.includes('{{username}}')) throw err; // config error — propagate
    return null;
  } finally {
    await svcClient.unbind().catch(() => {});
  }
}

async function testConnection(settings = {}) {
  if (!Client) {
    return { success: false, message: 'پکیج ldapts نصب نشده است', status: 'no_client' };
  }
  const cfg = ldapConfig(settings);
  if (!cfg.url) {
    return { success: false, message: 'LDAP URL تنظیم نشده است', status: 'no_url' };
  }
  const validation = validateConfig(cfg);
  if (!validation.valid) {
    return { success: false, message: validation.message, status: validation.status };
  }
  const client = createClient(cfg);
  try {
    await upgradeToTls(client, cfg);
    if (cfg.bindDn && cfg.bindPassword) {
      await client.bind(cfg.bindDn, cfg.bindPassword);
    }
    return { success: true, message: 'اتصال به LDAP با موفقیت برقرار شد', status: 'connected' };
  } catch (err) {
    return classifyConnectionError(err, cfg);
  } finally {
    await client.unbind().catch(() => {});
  }
}

module.exports = { isEnabled, authenticate, testConnection, validateConfig, ldapConfig };
