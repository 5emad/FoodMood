const crypto = require('crypto');
const zlib = require('zlib');

const User = require('../models/User');
const Department = require('../models/Department');
const Food = require('../models/Food');
const Week = require('../models/Week');
const Day = require('../models/Day');
const DailyMenu = require('../models/DailyMenu');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const AppSetting = require('../models/AppSetting');
const Counter = require('../models/Counter');
const SecurityLog = require('../models/SecurityLog');
const Announcement = require('../models/Announcement');

/*
 * Proprietary backup layout (only this server can decrypt):
 *   [6B magic "FZBAK1"][16B salt][12B IV][16B GCM tag][AES-256-GCM ciphertext]
 * Ciphertext = gzip(JSON). GCM AAD binds magic+salt; payload includes HMAC integrity.
 */
const MAGIC = Buffer.from('FZBAK1', 'ascii');
const FORMAT = 'sazman-food-backup';
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const DEV_FALLBACK = 'development-only-backup-secret-change-me';

const collectionMap = {
  departments: Department,
  users: User,
  foods: Food,
  days: Day,
  weeks: Week,
  dailyMenus: DailyMenu,
  menuItems: MenuItem,
  orders: Order,
  appSettings: AppSetting,
  counters: Counter,
  securityLogs: SecurityLog,
  announcements: Announcement,
};

function backupSecret() {
  const secret = process.env.BACKUP_SECRET
    || process.env.SESSION_SECRET
    || process.env.JWT_SECRET
    || DEV_FALLBACK;

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.BACKUP_SECRET) {
      throw new Error('BACKUP_SECRET is required in production for encrypted backups');
    }
    if (secret === DEV_FALLBACK) {
      throw new Error('BACKUP_SECRET must not use the development fallback in production');
    }
  }
  return secret;
}

function deriveKey(salt) {
  return crypto.scryptSync(backupSecret(), salt, 32);
}

function signData(data, salt) {
  return crypto.createHmac('sha256', deriveKey(salt))
    .update(JSON.stringify(data))
    .digest('hex');
}

function verifyDataIntegrity(data, salt, integrity) {
  if (!integrity) return true; // legacy backups without signature
  const expected = signData(data, salt);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(integrity, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function invalidFileError() {
  const error = new Error('این فایل، پشتیبان معتبر این سامانه نیست یا دستکاری شده است.');
  error.status = 400;
  return error;
}

async function createBackupBuffer(createdBy = '') {
  const data = {};
  const counts = {};
  for (const [name, Model] of Object.entries(collectionMap)) {
    data[name] = await Model.find().lean();
    counts[name] = data[name].length;
  }

  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const integrity = signData(data, salt);

  const payload = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    createdBy,
    counts,
    integrity,
    data,
  };

  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const aad = Buffer.concat([MAGIC, salt]);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(salt), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { buffer: Buffer.concat([MAGIC, salt, iv, tag, encrypted]), counts };
}

function readBackupBuffer(buffer) {
  const headerLen = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN;
  if (!Buffer.isBuffer(buffer) || buffer.length <= headerLen) throw invalidFileError();
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw invalidFileError();

  let offset = MAGIC.length;
  const salt = buffer.subarray(offset, offset += SALT_LEN);
  const iv = buffer.subarray(offset, offset += IV_LEN);
  const tag = buffer.subarray(offset, offset += TAG_LEN);
  const encrypted = buffer.subarray(offset);
  const aad = Buffer.concat([MAGIC, salt]);

  let payload;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(salt), iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  } catch {
    throw invalidFileError();
  }

  if (payload?.format !== FORMAT || Number(payload?.version) !== VERSION || typeof payload?.data !== 'object') {
    throw invalidFileError();
  }
  if (!verifyDataIntegrity(payload.data, salt, payload.integrity)) {
    throw invalidFileError();
  }
  return payload;
}

async function replaceCollection(Model, docs) {
  await Model.deleteMany({});
  if (docs.length) {
    await Model.insertMany(docs, { ordered: false });
  }
}

async function restoreBackup(payload) {
  const snapshot = {};
  for (const [name, Model] of Object.entries(collectionMap)) {
    snapshot[name] = await Model.find().lean();
  }

  const summary = {};
  try {
    for (const [name, Model] of Object.entries(collectionMap)) {
      const docs = Array.isArray(payload.data[name]) ? payload.data[name] : [];
      await replaceCollection(Model, docs);
      summary[name] = docs.length;
    }
  } catch (err) {
    for (const [name, Model] of Object.entries(collectionMap)) {
      try {
        await replaceCollection(Model, snapshot[name]);
      } catch (rollbackErr) {
        console.error(`Backup rollback failed for ${name}:`, rollbackErr.message);
      }
    }
    const error = new Error('بازیابی ناموفق بود؛ داده‌های قبلی برگردانده شدند. (' + err.message + ')');
    error.status = 500;
    throw error;
  }

  return { summary, createdAt: payload.createdAt || null };
}

module.exports = { createBackupBuffer, readBackupBuffer, restoreBackup };
