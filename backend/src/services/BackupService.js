const crypto = require('crypto');
const zlib = require('zlib');

const User = require('../models/User');
const Department = require('../models/Department');
const Food = require('../models/Food');
const FoodCategory = require('../models/FoodCategory');
const Week = require('../models/Week');
const Day = require('../models/Day');
const DailyMenu = require('../models/DailyMenu');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const Guest = require('../models/Guest');
const LdapProfile = require('../models/LdapProfile');
const AppSetting = require('../models/AppSetting');
const Counter = require('../models/Counter');
const SecurityLog = require('../models/SecurityLog');
const Announcement = require('../models/Announcement');
const UserSession = require('../models/UserSession');

/*
 * Proprietary backup layout (only this server can decrypt):
 *   [6B magic "FZBAK1"][16B salt][12B IV][16B GCM tag][AES-256-GCM ciphertext]
 * Ciphertext = gzip(JSON). GCM AAD binds magic+salt; payload includes HMAC integrity.
 */
const MAGIC = Buffer.from('FZBAK1', 'ascii');
const FORMAT = 'sazman-food-backup';
const VERSION = 2;
const SUPPORTED_VERSIONS = new Set([1, 2]);
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const DEV_FALLBACK = 'development-only-backup-secret-change-me';

/** همهٔ کالکشن‌های مهم سامانه */
const collectionMap = {
  departments: Department,
  foodCategories: FoodCategory,
  users: User,
  foods: Food,
  days: Day,
  weeks: Week,
  dailyMenus: DailyMenu,
  menuItems: MenuItem,
  guests: Guest,
  ldapProfiles: LdapProfile,
  orders: Order,
  appSettings: AppSetting,
  counters: Counter,
  securityLogs: SecurityLog,
  announcements: Announcement,
};

/** فیلدهایی که در schema با select:false مخفی‌اند و باید در بکاپ بیایند */
const hiddenSelect = {
  users: '+password +superTokenHash',
  appSettings: '+ldapBindPasswordEnc',
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
  if (!integrity) {
    if (process.env.NODE_ENV === 'production') return false;
    return true;
  }
  const expected = signData(data, salt);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(integrity), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function invalidFileError(detail) {
  const error = new Error(detail || 'این فایل، پشتیبان معتبر این سامانه نیست یا دستکاری شده است.');
  error.status = 400;
  return error;
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * خواندن کامل یک کالکشن (شامل فیلدهای select:false)
 */
async function dumpCollection(name, Model) {
  const extra = hiddenSelect[name];
  if (extra) {
    return Model.find().select(extra).lean();
  }
  return Model.collection.find({}).toArray();
}

async function dumpAll() {
  const data = {};
  const counts = {};
  for (const [name, Model] of Object.entries(collectionMap)) {
    data[name] = await dumpCollection(name, Model);
    counts[name] = data[name].length;
  }
  return { data, counts };
}

function isLdapUserDoc(user = {}) {
  return user.ldapUser === true
    || user.ldapUser === 'true'
    || user.ldapUser === 1;
}

/**
 * کاربران LDAP فقط پروفایل‌شان در بکاپ می‌آید (بدون password محلی).
 * کاربران محلی رمز هش‌شده را نگه می‌دارند.
 */
function sanitizeUsersForBackup(users = []) {
  return (users || []).map((user) => {
    const doc = { ...user };
    if (isLdapUserDoc(doc)) {
      delete doc.password;
      delete doc.superTokenHash;
    }
    return doc;
  });
}

/**
 * برای insertMany: LDAP بدون رمز → placeholder غیرقابل‌ورود محلی
 */
function prepareUsersForRestore(users = []) {
  return (users || []).map((user) => {
    const doc = { ...user };
    if (isLdapUserDoc(doc) && !doc.password) {
      doc.password = `!ldap-restored!${crypto.randomBytes(24).toString('hex')}`;
      doc.mustChangePassword = false;
    }
    return doc;
  });
}

async function createBackupBuffer(createdBy = '') {
  const { data, counts } = await dumpAll();
  data.users = sanitizeUsersForBackup(data.users);
  counts.users = data.users.length;

  const localWithoutPassword = (data.users || []).filter((u) => !isLdapUserDoc(u) && !u?.password);
  if (localWithoutPassword.length > 0) {
    throw httpError(
      `پشتیبان‌گیری ناقص ماند: ${localWithoutPassword.length} کاربر محلی بدون رمز. دوباره تلاش کنید.`,
      500,
    );
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

  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
  const aad = Buffer.concat([MAGIC, salt]);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(salt), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    buffer: Buffer.concat([MAGIC, salt, iv, tag, encrypted]),
    counts,
    createdAt: payload.createdAt,
  };
}

function readBackupBuffer(buffer) {
  const headerLen = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN;
  if (!Buffer.isBuffer(buffer) || buffer.length <= headerLen) {
    throw invalidFileError('فایل پشتیبان خالی یا ناقص است.');
  }
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw invalidFileError('فرمت فایل پشتیبان شناخته نشد (پسوند یا محتوا اشتباه است).');
  }

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
    throw invalidFileError(
      'رمزگشایی فایل ناموفق بود. معمولاً به‌خاطر BACKUP_SECRET متفاوت یا فایل خراب است.',
    );
  }

  if (payload?.format !== FORMAT || typeof payload?.data !== 'object' || !payload.data) {
    throw invalidFileError();
  }
  if (!SUPPORTED_VERSIONS.has(Number(payload.version))) {
    throw invalidFileError(`نسخه پشتیبان (${payload.version}) پشتیبانی نمی‌شود.`);
  }
  if (!verifyDataIntegrity(payload.data, salt, payload.integrity)) {
    throw invalidFileError('یکپارچگی فایل پشتیبان تأیید نشد (ممکن است دستکاری شده باشد).');
  }
  return payload;
}

function normalizeDocs(docs) {
  return (Array.isArray(docs) ? docs : []).map((doc) => {
    if (!doc || typeof doc !== 'object') return doc;
    const out = { ...doc };
    if (out._id != null && typeof out._id === 'object' && out._id.$oid) {
      out._id = out._id.$oid;
    }
    return out;
  });
}

async function replaceCollection(Model, docs, session = null) {
  const options = session ? { session } : {};
  await Model.deleteMany({}, options);
  const list = normalizeDocs(docs);
  if (!list.length) return 0;
  await Model.insertMany(list, { ...options, ordered: true });
  return list.length;
}

function assertUsersRestorable(users) {
  const list = Array.isArray(users) ? users : [];
  if (!list.length) return;
  const localMissing = list.filter((u) => !isLdapUserDoc(u) && !u?.password);
  if (localMissing.length > 0) {
    throw httpError(
      localMissing.length === list.filter((u) => !isLdapUserDoc(u)).length
        ? 'این فایل پشتیبان ناقص است و رمز کاربران محلی را ندارد. یک پشتیبان جدید بگیرید.'
        : `این فایل پشتیبان ناقص است: ${localMissing.length} کاربر محلی بدون رمز. پشتیبان جدید بگیرید.`,
      400,
    );
  }
}

async function applyPayloadData(data, session = null) {
  const summary = {};
  for (const [name, Model] of Object.entries(collectionMap)) {
    let docs = Array.isArray(data[name]) ? data[name] : [];
    if (name === 'users') docs = prepareUsersForRestore(docs);
    summary[name] = await replaceCollection(Model, docs, session);
  }
  // نشست‌ها را خالی می‌کنیم تا توکن‌های قبلی با دادهٔ جدید تداخل نکنند
  await UserSession.deleteMany({}, session ? { session } : {});
  summary.userSessions = 0;
  return summary;
}

async function rollbackFromSnapshot(snapshot) {
  const failures = [];
  for (const [name, Model] of Object.entries(collectionMap)) {
    try {
      await replaceCollection(Model, snapshot[name] || []);
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
      console.error(`[backup] rollback failed for ${name}:`, err.message);
    }
  }
  try {
    await UserSession.deleteMany({});
  } catch (err) {
    failures.push(`userSessions: ${err.message}`);
  }
  return failures;
}

/**
 * بازیابی با snapshot کامل (شامل رمزها) و rollback در صورت خطا.
 * تراکنش Mongo فقط روی replica set در دسترس است؛ این مسیر برای نصب‌های معمول مطمئن‌تر است.
 */
async function restoreBackup(payload) {
  assertUsersRestorable(payload.data?.users);

  const snapshot = {};
  for (const [name, Model] of Object.entries(collectionMap)) {
    snapshot[name] = await dumpCollection(name, Model);
  }

  try {
    const summary = await applyPayloadData(payload.data, null);
    return { summary, createdAt: payload.createdAt || null, mode: 'snapshot-rollback' };
  } catch (err) {
    const failures = await rollbackFromSnapshot(snapshot);
    const rolledBack = failures.length === 0;
    throw httpError(
      rolledBack
        ? `بازیابی ناموفق بود؛ داده‌های قبلی برگردانده شدند. (${err.message})`
        : `بازیابی ناموفق بود و بازگردانی کامل ممکن نشد (${failures.join(' | ')}). فوراً از پشتیبان دیگر استفاده کنید. علت: ${err.message}`,
      500,
    );
  }
}

module.exports = {
  createBackupBuffer,
  readBackupBuffer,
  restoreBackup,
  collectionMap,
  VERSION,
};
