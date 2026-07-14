let Client;
try { ({ Client } = require('ldapts')); } catch { Client = null; }
const fs = require('fs');
const net = require('net');
const { resolveLdapBindPassword } = require('./SecurityHelper');

const DEFAULT_TIMEOUT_MS = 20000;

function resolveTimeoutMs(settings = {}) {
  const fromSettings = Number(settings.ldapTimeoutMs);
  if (Number.isFinite(fromSettings) && fromSettings >= 3000) return Math.min(fromSettings, 120000);
  const fromEnv = Number(process.env.LDAP_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 3000) return Math.min(fromEnv, 120000);
  return DEFAULT_TIMEOUT_MS;
}

function parseLdapEndpoint(url) {
  const parsed = new URL(url);
  const port = parsed.port
    ? Number(parsed.port)
    : (parsed.protocol === 'ldaps:' ? 636 : 389);
  return { host: parsed.hostname, port };
}

function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

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

  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'ldaps:' ? 636 : 389);
  if (security === 'ldaps' && port === 389) {
    return { valid: false, message: 'برای LDAPS از پورت 636 استفاده کنید یا آدرس را ldaps://host:636 بنویسید', status: 'bad_port' };
  }
  if (security === 'ldap' && port === 636) {
    return { valid: false, message: 'برای LDAP ساده پورت 389 و آدرس ldap:// استفاده کنید، نه 636', status: 'bad_port' };
  }
  if (security === 'starttls' && port === 636) {
    return { valid: false, message: 'StartTLS معمولاً روی پورت 389 است (ldap://host:389)', status: 'bad_port' };
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

function classifyAdBindError(msg) {
  const match = String(msg).match(/data\s+([0-9a-fA-F]+)/i);
  if (!match) return null;

  const hints = {
    '525': {
      message: 'اکانت Bind در Active Directory پیدا نشد (Bind DN اشتباه است).',
      status: 'user_not_found',
    },
    '52e': {
      message: 'Bind DN یا رمز Bind اشتباه است.',
      status: 'auth_error',
    },
    '530': {
      message: 'اکانت Bind در این زمان اجازه ورود ندارد (محدودیت ساعت ورود در AD).',
      status: 'logon_hours',
    },
    '531': {
      message: 'اکانت Bind اجازه ورود از این سرور/ایستگاه کاری را ندارد.',
      status: 'workstation',
    },
    '532': {
      message: 'رمز اکانت Bind منقضی شده است. در AD رمز را تغییر دهید.',
      status: 'password_expired',
    },
    '533': {
      message: 'اکانت Bind در Active Directory غیرفعال است.',
      status: 'account_disabled',
    },
    '701': {
      message: 'اکانت Bind منقضی شده است.',
      status: 'account_expired',
    },
    '773': {
      message: 'اکانت Bind باید در اولین ورود رمز را عوض کند. از AD رمز را تنظیم کنید.',
      status: 'password_must_change',
    },
    '775': {
      message: 'اکانت Bind در Active Directory قفل شده است. در AD آن را Unlock کنید یا چند دقیقه صبر کنید، سپس Bind DN و رمز را دوباره بررسی کنید.',
      status: 'account_locked',
    },
  };

  return hints[match[1].toLowerCase()] || null;
}

function classifyConnectionError(err, cfg) {
  const msg = String(err.message || 'خطا در اتصال');
  const lower = msg.toLowerCase();

  const adBind = classifyAdBindError(msg);
  if (adBind) {
    return { success: false, message: adBind.message, status: adBind.status };
  }

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
  if (msg.includes('ETIMEDOUT') || lower.includes('timeout')) {
    const { host, port } = parseLdapEndpoint(cfg.url);
    let hint = 'اتصال LDAP از سرور سامانه timeout شد.';
    if (cfg.security === 'ldaps') {
      hint += ' اگر فقط پورت 389 باز است، نوع اتصال را LDAP یا StartTLS انتخاب کنید.';
    } else if (cfg.security === 'ldap') {
      hint += ' اگر DC فقط LDAPS دارد، نوع اتصال LDAPS و پورت 636 را امتحان کنید.';
    } else {
      hint += ' StartTLS را با ldap:// و پورت 389 تست کنید یا در صورت نیاز LDAPS.';
    }
    return {
      success: false,
      message: `${hint} (${host}:${port})`,
      status: 'timeout',
    };
  }
  if (lower.includes('invalid credentials')) return { success: false, message: 'نام کاربری یا رمز Bind اشتباه است', status: 'auth_error' };
  if (lower.includes('certificate') || msg.includes('SSL') || msg.includes('TLS')) return { success: false, message: `خطای SSL/TLS: ${msg}`, status: 'tls_error' };
  return { success: false, message: msg, status: 'error' };
}

function createClient(cfg, settings = {}) {
  const validation = validateConfig(cfg);
  if (!validation.valid) throw new Error(validation.message);
  const timeoutMs = resolveTimeoutMs(settings);
  const opts = {
    url:            cfg.url,
    timeout:        timeoutMs,
    connectTimeout: timeoutMs,
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

function normalizeLoginIdentifier(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return { sam: '', upn: null, raw: '' };
  if (raw.includes('\\')) {
    const sam = raw.split('\\').pop().trim();
    return { sam, upn: null, raw };
  }
  if (raw.includes('@')) {
    const sam = raw.split('@')[0].trim();
    return { sam, upn: raw, raw };
  }
  return { sam: raw, upn: null, raw };
}

function inferUpnSuffix(baseDn) {
  const matches = [...String(baseDn || '').matchAll(/DC=([^,]+)/gi)];
  if (!matches.length) return '';
  return `@${matches.map((match) => match[1]).join('.')}`;
}

function collectUpnCandidates(identity, baseDn) {
  const candidates = new Set();
  if (identity.upn) candidates.add(identity.upn);
  const suffix = inferUpnSuffix(baseDn);
  if (identity.sam && suffix) candidates.add(`${identity.sam}${suffix}`);
  return [...candidates];
}

function buildUserSearchFilter(cfg, identity) {
  const clauses = [buildFilter(cfg.userFilter, identity.sam)];
  collectUpnCandidates(identity, cfg.baseDn).forEach((upn) => {
    clauses.push(`(userPrincipalName=${escapeFilterValue(upn)})`);
  });
  if (clauses.length === 1) return clauses[0];
  return `(|${clauses.join('')})`;
}

async function authenticateViaUpnBind(upn, password, cfg, settings) {
  const client = createClient(cfg, settings);
  const attrs = ['sAMAccountName', 'cn', 'displayName', 'mail', 'department', 'dn'];
  try {
    await upgradeToTls(client, cfg);
    await client.bind(upn, password);
    const sam = upn.split('@')[0];
    const filter = `(|(userPrincipalName=${escapeFilterValue(upn)})(sAMAccountName=${escapeFilterValue(sam)}))`;
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: 'sub',
      filter,
      attributes: attrs,
      sizeLimit: 1,
    });
    const entry = searchEntries[0] || {};
    return {
      username: entry.sAMAccountName || sam,
      displayName: entry.displayName || entry.cn || sam,
      email: entry.mail || null,
      department: entry.department || null,
    };
  } catch {
    return null;
  } finally {
    await client.unbind().catch(() => {});
  }
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

  const identity = normalizeLoginIdentifier(username);
  if (!identity.sam) return null;

  const svcClient = createClient(cfg, settings);
  try {
    await upgradeToTls(svcClient, cfg);

    if (cfg.bindDn) {
      await svcClient.bind(cfg.bindDn, cfg.bindPassword);
    }

    const filter = buildUserSearchFilter(cfg, identity);
    const { searchEntries } = await svcClient.search(cfg.baseDn, {
      scope:      'sub',
      filter,
      attributes: ['sAMAccountName', 'cn', 'displayName', 'mail', 'department', 'dn'],
      sizeLimit:  2,
    });

    if (searchEntries.length) {
      const entry  = searchEntries[0];
      const userDn = entry.dn;

      const userClient = createClient(cfg, settings);
      try {
        await upgradeToTls(userClient, cfg);
        await userClient.bind(userDn, password);
        return {
          username:    entry.sAMAccountName || identity.sam,
          displayName: entry.displayName    || entry.cn || identity.sam,
          email:       entry.mail           || null,
          department:  entry.department     || null,
        };
      } catch {
        return null;
      } finally {
        await userClient.unbind().catch(() => {});
      }
    }
  } catch (err) {
    if (err.message?.includes('{{username}}')) throw err;
  } finally {
    await svcClient.unbind().catch(() => {});
  }

  for (const upn of collectUpnCandidates(identity, cfg.baseDn)) {
    const viaUpn = await authenticateViaUpnBind(upn, password, cfg, settings);
    if (viaUpn) return viaUpn;
  }

  return null;
}

async function testConnection(settings = {}) {
  if (!Client) {
    return { success: false, message: 'پکیج ldapts نصب نشده است', status: 'no_client' };
  }
  const enabled = settings.ldapEnabled === true || settings.ldapEnabled === 'true' || settings.ldapEnabled === '1';
  if (!enabled) {
    return { success: false, message: 'LDAP در تنظیمات غیرفعال است', status: 'disabled' };
  }

  const cfg = ldapConfig(settings);
  if (!cfg.url) {
    return { success: false, message: 'LDAP URL تنظیم نشده است', status: 'no_url' };
  }
  if (!cfg.baseDn) {
    return { success: false, message: 'Base DN تنظیم نشده است', status: 'no_base_dn' };
  }
  if (!cfg.bindDn) {
    return { success: false, message: 'Bind DN برای تست اتصال الزامی است', status: 'no_bind_dn' };
  }
  if (!cfg.bindPassword) {
    return { success: false, message: 'رمز Bind برای تست اتصال الزامی است (ذخیره‌شده یا وارد شده در فرم)', status: 'no_bind_password' };
  }

  const validation = validateConfig(cfg);
  if (!validation.valid) {
    return { success: false, message: validation.message, status: validation.status };
  }

  const timeoutMs = resolveTimeoutMs(settings);
  const { host, port } = parseLdapEndpoint(cfg.url);
  const tcpOk = await probeTcp(host, port, timeoutMs);
  if (!tcpOk) {
    return {
      success: false,
      message: `از سرور سامانه به ${host}:${port} در ${Math.round(timeoutMs / 1000)} ثانیه پاسخی نرسید. ممکن است از کامپیوتر شما پورت باز باشد ولی سرور FoodMood به DC دسترسی شبکه‌ای نداشته باشد.`,
      status: 'tcp_timeout',
    };
  }

  const client = createClient(cfg, settings);
  try {
    await upgradeToTls(client, cfg);
    await client.bind(cfg.bindDn, cfg.bindPassword);
    await client.search(cfg.baseDn, {
      scope: 'base',
      filter: '(objectClass=*)',
      attributes: ['dn'],
      sizeLimit: 1,
      timeLimit: Math.max(5, Math.ceil(timeoutMs / 1000)),
    });
    return { success: true, message: 'اتصال و احراز هویت LDAP با موفقیت انجام شد', status: 'connected' };
  } catch (err) {
    return classifyConnectionError(err, cfg);
  } finally {
    await client.unbind().catch(() => {});
  }
}

module.exports = {
  isEnabled,
  authenticate,
  testConnection,
  validateConfig,
  ldapConfig,
  normalizeLoginIdentifier,
};
