const crypto = require('crypto');

const ENC_PREFIX = 'ann:';
const ALGO = 'aes-256-gcm';
const DEV_FALLBACK = 'development-only-announcement-key-change-me';

function announcementKey() {
  const raw = process.env.ANNOUNCEMENT_ENCRYPTION_KEY
    || process.env.LDAP_ENCRYPTION_KEY
    || process.env.SESSION_SECRET
    || DEV_FALLBACK;

  if (process.env.NODE_ENV === 'production' && raw === DEV_FALLBACK) {
    console.warn('WARNING: ANNOUNCEMENT_ENCRYPTION_KEY is not set; using insecure development fallback.');
  }

  return crypto.scryptSync(raw, 'announcement-kdf-salt-v1', 32);
}

function encryptAnnouncementText(plaintext) {
  const text = String(plaintext ?? '');
  if (!text) return '';

  const key = announcementKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptAnnouncementText(ciphertext) {
  const stored = String(ciphertext || '');
  if (!stored || !stored.startsWith(ENC_PREFIX)) return '';

  try {
    const parts = stored.slice(ENC_PREFIX.length).split(':');
    if (parts.length !== 3) return '';

    const [ivHex, tagHex, encHex] = parts;
    const key = announcementKey();
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
}

module.exports = {
  encryptAnnouncementText,
  decryptAnnouncementText,
};
