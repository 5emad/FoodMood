const crypto = require('crypto');
const QRCode = require('qrcode');
const Guest = require('../models/Guest');
const { hashPassword, comparePassword } = require('../helpers/SecurityHelper');
const { buildAbsoluteUrl } = require('../helpers/AppUrlHelper');
const { issueCaptcha, verifyCaptcha } = require('../helpers/CaptchaHelper');
const { writeSecurityLog } = require('./SecurityLogService');
const { isGuestActive } = require('./GuestService');

/**
 * کانال ورود مهمان — کاملاً جدا از ورود کارکنان:
 *  - /guest       : شناسه + رمز + کپچا (کپچا با کلید نشست جدا، قفل و محدودیت جدا)
 *  - /guest/<t>   : لینک ورود مستقیم یک‌بارمصرف با اعتبار ۳۰ یا ۶۰ دقیقه (فقط هش توکن ذخیره می‌شود)
 */
const GUEST_SESSION_MAX_MS = 12 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MS = 30 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const MAGIC_DURATIONS_MIN = [30, 60];
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;
const CAPTCHA_KEY = 'guestCaptcha';
// هش واقعی (همان هزینه bcrypt) برای یکسان شدن زمان پاسخ وقتی شناسه وجود ندارد یا رمز ندارد
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(18).toString('base64url'));
  return dummyHashPromise;
}

function httpError(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function uaHash(req) {
  return crypto.createHash('sha256').update(String(req.get('user-agent') || '')).digest('base64url').slice(0, 22);
}

function normalizeCode(value) {
  const map = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  };
  return String(value ?? '').replace(/[۰-۹٠-٩]/g, (d) => map[d] || d).trim().slice(0, 20);
}

/** req.user ساختگی برای استفاده از همان مسیرهای سفارش/صورتحساب/پرداخت کاربران */
function guestActor(guest) {
  return {
    id: `guest:${guest._id}`,
    guestId: String(guest._id),
    guestCode: guest.guestCode,
    username: guest.guestCode,
    fullName: guest.fullName,
    department: guest.department || 'مهمان',
    role: 'guest',
    authSource: 'guest',
  };
}

function magicStatus(guest) {
  const expiresAt = guest.magicExpiresAt ? new Date(guest.magicExpiresAt) : null;
  const active = !!(guest.magicTokenHash && expiresAt && expiresAt.getTime() > Date.now() && !guest.magicUsedAt);
  return {
    active,
    createdAt: guest.magicCreatedAt || null,
    expiresAt,
    usedAt: guest.magicUsedAt || null,
  };
}

// ── مدیریت دسترسی (پنل مدیر) ───────────────────────────────────────────────

async function loadGuestWithSecrets(guestId) {
  if (!/^[a-f0-9]{24}$/i.test(String(guestId || ''))) throw httpError('مهمان یافت نشد', 404);
  const guest = await Guest.findById(guestId).select('+passwordHash +magicTokenHash');
  if (!guest) throw httpError('مهمان یافت نشد', 404);
  return guest;
}

async function accessInfo(req, guestId) {
  const guest = await loadGuestWithSecrets(guestId);
  return {
    guestId: String(guest._id),
    guestCode: guest.guestCode,
    fullName: guest.fullName,
    hasPassword: !!guest.passwordHash,
    active: isGuestActive(guest),
    loginUrl: await buildAbsoluteUrl(req, '/guest'),
    magic: magicStatus(guest),
    durations: MAGIC_DURATIONS_MIN,
  };
}

/** لینک ورود مستقیم جدید — لینک قبلی همان مهمان باطل می‌شود. لینک فقط همین یک بار نمایش داده می‌شود. */
async function createMagicLink(req, guestId, minutes) {
  const duration = MAGIC_DURATIONS_MIN.includes(Number(minutes)) ? Number(minutes) : 30;
  const guest = await loadGuestWithSecrets(guestId);
  if (!isGuestActive(guest)) throw httpError('مهمان غیرفعال یا منقضی است؛ ابتدا آن را فعال کنید', 409);
  const token = crypto.randomBytes(32).toString('base64url');
  guest.magicTokenHash = sha256(token);
  guest.magicCreatedAt = new Date();
  guest.magicExpiresAt = new Date(Date.now() + duration * 60 * 1000);
  guest.magicUsedAt = null;
  await guest.save();
  const link = await buildAbsoluteUrl(req, `/guest/${token}`);
  const qrSvg = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', width: 240 });
  writeSecurityLog(req, 'guest_magic_link', { username: guest.guestCode }, 'لینک ورود مستقیم مهمان ساخته شد', {
    guestId: String(guest._id), minutes: duration, by: req.user?.username || '',
  });
  return { ...(await accessInfo(req, guestId)), link, qrSvg };
}

async function revokeMagicLink(req, guestId) {
  await loadGuestWithSecrets(guestId);
  await Guest.updateOne({ _id: guestId }, { $set: { magicTokenHash: '', magicExpiresAt: null } });
  return accessInfo(req, guestId);
}

/** خروج همه نشست‌های فعلی مهمان */
async function revokeSessions(guestId) {
  await Guest.updateOne({ _id: guestId }, { $inc: { linkVersion: 1 } });
}

async function setGuestPassword(guestId, password) {
  const guest = await loadGuestWithSecrets(guestId);
  const value = String(password ?? '');
  if (value) {
    if (value.length < MIN_PASSWORD_LENGTH || !/[A-Za-z]/.test(value) || !/\d/.test(value)) {
      throw httpError(`رمز مهمان باید حداقل ${MIN_PASSWORD_LENGTH} کاراکتر و شامل حرف و عدد باشد`);
    }
    if (value.length > 128) throw httpError('رمز بیش از حد طولانی است');
    if (value.includes(guest.guestCode)) throw httpError('رمز نباید شامل شناسه مهمان باشد');
  }
  await Guest.updateOne({ _id: guest._id }, {
    $set: { passwordHash: value ? await hashPassword(value) : '', loginAttempts: 0, lockUntil: null },
    $inc: { linkVersion: 1 },
  });
  return { hasPassword: !!value };
}

// ── ورود مهمان (عمومی) ─────────────────────────────────────────────────────

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session?.regenerate) return resolve();
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

async function startGuestSession(req, guest, method) {
  // جلوگیری از session fixation
  await regenerateSession(req);
  req.session.guestAuth = {
    guestId: String(guest._id),
    v: Number(guest.linkVersion || 1),
    at: Date.now(),
    ua: uaHash(req),
    via: method,
  };
  await Guest.updateOne({ _id: guest._id }, { $set: { loginAttempts: 0, lockUntil: null, lastLoginAt: new Date() } });
  writeSecurityLog(req, 'guest_login_success', { username: guest.guestCode }, `ورود مهمان (${method === 'link' ? 'لینک مستقیم' : 'رمز'})`, {
    guestId: String(guest._id),
  });
}

function guestCaptcha(req) {
  return issueCaptcha(req, CAPTCHA_KEY);
}

/** ورود از صفحه عمومی /guest: شناسه + رمز + کپچا */
async function loginWithPassword(req, { code, password, captcha }) {
  const check = verifyCaptcha(req, captcha, CAPTCHA_KEY);
  if (!check.ok) throw httpError(check.message, 400, 'captcha');

  const generic = 'شناسه یا رمز مهمان صحیح نیست';
  const guestCode = normalizeCode(code);
  const pw = String(password || '').slice(0, 128);
  const guest = /^\d{3,12}$/.test(guestCode)
    ? await Guest.findOne({ guestCode }).select('+passwordHash +loginAttempts +lockUntil')
    : null;

  if (guest?.lockUntil && guest.lockUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((guest.lockUntil.getTime() - Date.now()) / 60000);
    throw httpError(`به‌دلیل تلاش‌های ناموفق، ورود این حساب تا ${minutes.toLocaleString('fa-IR')} دقیقه دیگر ممکن نیست`, 429, 'locked');
  }

  // همیشه یک مقایسه bcrypt انجام می‌شود تا وجود/نبود شناسه یا رمز از زمان پاسخ معلوم نشود
  const hash = guest?.passwordHash || await dummyHash();
  const passwordOk = await comparePassword(pw, hash).catch(() => false);
  const ok = !!guest && !!guest.passwordHash && pw.length > 0 && passwordOk;

  if (!ok) {
    if (guest) {
      const attempts = Number(guest.loginAttempts || 0) + 1;
      const update = { loginAttempts: attempts };
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        update.lockUntil = new Date(Date.now() + LOCK_MS);
        update.loginAttempts = 0;
        writeSecurityLog(req, 'guest_locked', { username: guest.guestCode }, 'قفل ورود مهمان پس از تلاش‌های ناموفق', { guestId: String(guest._id) });
      }
      await Guest.updateOne({ _id: guest._id }, { $set: update });
    }
    writeSecurityLog(req, 'guest_login_failed', { username: guestCode }, 'ورود ناموفق مهمان', {});
    throw httpError(generic, 401, 'bad_credentials');
  }
  if (!isGuestActive(guest)) throw httpError('حساب مهمان غیرفعال یا منقضی شده است', 403, 'inactive');

  await startGuestSession(req, guest, 'password');
  return guest;
}

/** ورود با لینک مستقیم: یک‌بارمصرف و زمان‌دار (مصرف اتمیک) */
async function loginWithMagicLink(req, token) {
  const invalid = 'این لینک ورود منقضی شده، قبلاً استفاده شده یا معتبر نیست. لینک جدید را از مسئول سامانه بگیرید.';
  if (!TOKEN_RE.test(String(token || ''))) throw httpError(invalid, 410, 'link_invalid');
  const now = new Date();
  const guest = await Guest.findOneAndUpdate(
    { magicTokenHash: sha256(token), magicUsedAt: null, magicExpiresAt: { $gt: now } },
    { $set: { magicUsedAt: now, magicTokenHash: '' } },
    { new: true },
  );
  if (!guest) {
    writeSecurityLog(req, 'guest_login_failed', null, 'لینک ورود مهمان نامعتبر/منقضی', {});
    throw httpError(invalid, 410, 'link_invalid');
  }
  if (!isGuestActive(guest)) throw httpError('حساب مهمان غیرفعال یا منقضی شده است', 403, 'inactive');
  await startGuestSession(req, guest, 'link');
  return guest;
}

function logout(req) {
  if (req.session) delete req.session.guestAuth;
}

/** اعتبارسنجی نشست مهمان در هر درخواست */
async function resolveGuestSession(req) {
  const auth = req.session?.guestAuth;
  if (!auth?.guestId) return null;
  if (Date.now() - Number(auth.at || 0) > GUEST_SESSION_MAX_MS || auth.ua !== uaHash(req)) {
    logout(req);
    return null;
  }
  if (!/^[a-f0-9]{24}$/i.test(String(auth.guestId))) return null;
  const guest = await Guest.findById(auth.guestId).lean();
  if (!guest || !isGuestActive(guest) || Number(guest.linkVersion || 1) !== Number(auth.v)) {
    logout(req);
    return null;
  }
  return guest;
}

module.exports = {
  GUEST_SESSION_MAX_MS,
  MIN_PASSWORD_LENGTH,
  MAGIC_DURATIONS_MIN,
  guestActor,
  accessInfo,
  createMagicLink,
  revokeMagicLink,
  revokeSessions,
  setGuestPassword,
  guestCaptcha,
  loginWithPassword,
  loginWithMagicLink,
  logout,
  resolveGuestSession,
};
