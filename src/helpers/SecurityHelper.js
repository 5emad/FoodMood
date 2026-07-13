const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// ─── Password hashing (two-layer: HMAC pepper + bcrypt-12) ───────────────────

const PEPPER = process.env.PASSWORD_PEPPER;
const BCRYPT_ROUNDS = 12;
const SECRET_PREFIX = 'scrypt:v1:';
const SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

function pepperPassword(plaintext) {
  if (!PEPPER) return plaintext;
  return crypto.createHmac('sha256', PEPPER).update(plaintext).digest('hex');
}

const hashPassword = async (plaintext) => {
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
  return bcrypt.hash(pepperPassword(plaintext), salt);
};

const comparePassword = async (plaintext, hash) => {
  return bcrypt.compare(pepperPassword(plaintext), hash);
};

/**
 * Shared password policy: letters + digits required; superadmin-grade
 * secrets additionally require a symbol and a longer minimum.
 */
function validatePasswordPolicy(password, { minLength = 8, requireSymbol = false } = {}) {
  const pw = String(password || '');
  if (pw.length < minLength) return false;
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return false;
  if (requireSymbol && !/[^a-zA-Z0-9]/.test(pw)) return false;
  return true;
}

function hashSensitiveToken(plaintext) {
  const token = String(plaintext || '');
  const salt = crypto.randomBytes(24);
  const pepper = PEPPER || process.env.SUPERADMIN_TOKEN_PEPPER || '';
  const derived = crypto.scryptSync(`${pepper}:${token}`, salt, 64, SCRYPT_OPTS);
  return `${SECRET_PREFIX}${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

function compareSensitiveToken(plaintext, storedHash) {
  const token = String(plaintext || '');
  const stored = String(storedHash || '');
  if (!token || !stored.startsWith(SECRET_PREFIX)) return false;

  const parts = stored.slice(SECRET_PREFIX.length).split(':');
  if (parts.length !== 2) return false;
  const [saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');
  const pepper = PEPPER || process.env.SUPERADMIN_TOKEN_PEPPER || '';
  const actual = crypto.scryptSync(`${pepper}:${token}`, salt, expected.length, SCRYPT_OPTS);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ─── LDAP bind-password protection (multi-layer: scrypt + AES-256-GCM + HMAC) ─

const LDAP_ENC_KEY_RAW = process.env.LDAP_ENCRYPTION_KEY;
const ENC_PREFIX = 'enc:';
const LDAPSVC_PREFIX = 'ldapsvc:v2:';
const ALGO = 'aes-256-gcm';

function ldapMasterKeyMaterial() {
  return LDAP_ENC_KEY_RAW || process.env.BACKUP_SECRET || null;
}

function getLdapKey() {
  if (!LDAP_ENC_KEY_RAW) return null;
  return crypto.scryptSync(LDAP_ENC_KEY_RAW, 'ldap-kdf-salt-v1', 32, SCRYPT_OPTS);
}

function deriveLdapRecordKey(master, salt) {
  return crypto.scryptSync(master, salt, 32, SCRYPT_OPTS);
}

function encryptLdapBindSecret(plaintext) {
  const text = String(plaintext || '');
  if (!text) return '';

  const master = ldapMasterKeyMaterial();
  if (!master) {
    const error = new Error('LDAP_ENCRYPTION_KEY در سرور تنظیم نشده است');
    error.status = 500;
    throw error;
  }

  const salt = crypto.randomBytes(16);
  const key = deriveLdapRecordKey(master, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const hmac = crypto.createHmac('sha256', key).update(Buffer.concat([salt, iv, tag, encrypted])).digest();

  return `${LDAPSVC_PREFIX}${salt.toString('base64url')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}:${hmac.toString('hex')}`;
}

function decryptLdapBindSecret(stored) {
  const value = String(stored || '');
  if (!value) return '';

  if (value.startsWith(LDAPSVC_PREFIX)) {
    const master = ldapMasterKeyMaterial();
    if (!master) return '';

    try {
      const parts = value.slice(LDAPSVC_PREFIX.length).split(':');
      if (parts.length !== 5) return '';
      const [saltB64, ivHex, tagHex, encHex, hmacHex] = parts;
      const salt = Buffer.from(saltB64, 'base64url');
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');
      const enc = Buffer.from(encHex, 'hex');
      const key = deriveLdapRecordKey(master, salt);
      const expectedHmac = crypto.createHmac('sha256', key).update(Buffer.concat([salt, iv, tag, enc])).digest();
      const actualHmac = Buffer.from(hmacHex, 'hex');
      if (expectedHmac.length !== actualHmac.length || !crypto.timingSafeEqual(expectedHmac, actualHmac)) {
        return '';
      }
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch {
      return '';
    }
  }

  return decryptLdapPassword(value);
}

const encryptLdapPassword = (plaintext) => {
  if (!plaintext) return plaintext;
  if (LDAP_ENC_KEY_RAW) return encryptLdapBindSecret(plaintext);
  const key = getLdapKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

const decryptLdapPassword = (ciphertext) => {
  if (!ciphertext) return ciphertext;
  if (String(ciphertext).startsWith(LDAPSVC_PREFIX)) {
    return decryptLdapBindSecret(ciphertext);
  }
  if (!String(ciphertext).startsWith(ENC_PREFIX)) return ciphertext;

  const key = getLdapKey();
  if (!key) return '';

  try {
    const parts = ciphertext.slice(ENC_PREFIX.length).split(':');
    if (parts.length !== 3) return '';
    const [ivHex, tagHex, encHex] = parts;

    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
};

function resolveLdapBindPassword({ transientPassword, storedEnc, envValue } = {}) {
  if (transientPassword) return String(transientPassword);
  if (storedEnc) {
    const fromDb = decryptLdapBindSecret(storedEnc);
    if (fromDb) return fromDb;
  }
  if (!envValue) return '';
  const fromEnv = decryptLdapBindSecret(envValue);
  return fromEnv || String(envValue);
}

// ─── Input helpers ────────────────────────────────────────────────────────────

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const validatePhone = (phone) => /^[0-9]{10,11}$/.test(phone);

const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

// Escape user-supplied strings before embedding in a RegExp
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  hashPassword,
  comparePassword,
  validatePasswordPolicy,
  hashSensitiveToken,
  compareSensitiveToken,
  encryptLdapPassword,
  decryptLdapPassword,
  encryptLdapBindSecret,
  decryptLdapBindSecret,
  resolveLdapBindPassword,
  validateEmail,
  validatePhone,
  sanitizeInput,
  escapeRegex,
};
