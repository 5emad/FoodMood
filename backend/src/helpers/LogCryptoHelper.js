const crypto = require('crypto');

const ENC_PREFIX = 'lfm:v1:';
const ALGO = 'aes-256-gcm';
const KDF_SALT = 'foodmood-log-field-v1';
const DEV_FALLBACK = 'development-only-log-key-change-me';

function resolveMasterSecret() {
  const raw = process.env.LOG_ENCRYPTION_KEY
    || process.env.BACKUP_SECRET
    || process.env.SESSION_SECRET
    || DEV_FALLBACK;

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.LOG_ENCRYPTION_KEY) {
      throw new Error('LOG_ENCRYPTION_KEY is required in production for encrypted logs');
    }
    if (raw === DEV_FALLBACK) {
      throw new Error('LOG_ENCRYPTION_KEY must not use the development fallback in production');
    }
  } else if (!process.env.LOG_ENCRYPTION_KEY) {
    console.warn('WARNING: LOG_ENCRYPTION_KEY is not set; using derived development fallback.');
  }

  return raw;
}

let derivedKey = null;

function logKey() {
  if (!derivedKey) {
    const secret = resolveMasterSecret();
    derivedKey = crypto.scryptSync(secret, KDF_SALT, 32, { N: 16384, r: 8, p: 1 });
  }
  return derivedKey;
}

function encryptField(plaintext) {
  const text = String(plaintext ?? '');
  if (!text) return '';

  const key = logKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENC_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64url')}`;
}

function decryptField(stored) {
  const raw = String(stored || '');
  if (!raw) return '';
  if (!raw.startsWith(ENC_PREFIX)) return raw;

  try {
    const buf = Buffer.from(raw.slice(ENC_PREFIX.length), 'base64url');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, logKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function encryptJsonObject(obj) {
  if (!obj || (typeof obj === 'object' && !Object.keys(obj).length)) return '';
  return encryptField(JSON.stringify(obj));
}

function decryptJsonObject(stored) {
  if (!stored) return {};
  const text = decryptField(stored);
  if (!text) {
    if (typeof stored === 'object' && stored !== null && !String(stored).startsWith(ENC_PREFIX)) {
      return stored;
    }
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function encryptLogEntry(entry) {
  return encryptField(JSON.stringify(entry));
}

function decryptLogEntry(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;

  if (raw.startsWith(ENC_PREFIX)) {
    const text = decryptField(raw);
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function decryptSecurityLogDoc(doc) {
  if (!doc) return doc;
  const metadata = doc.metadata?.enc
    ? decryptJsonObject(doc.metadata.enc)
    : (doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {});

  return {
    ...doc,
    ip: decryptField(doc.ip),
    userAgent: decryptField(doc.userAgent),
    message: decryptField(doc.message),
    metadata,
  };
}

module.exports = {
  ENC_PREFIX,
  encryptField,
  decryptField,
  encryptJsonObject,
  decryptJsonObject,
  encryptLogEntry,
  decryptLogEntry,
  decryptSecurityLogDoc,
};
