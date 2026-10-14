const crypto = require('crypto');
const mongoose = require('mongoose');
const DiscountCode = require('../models/DiscountCode');
const Payment = require('../models/Payment');
const Department = require('../models/Department');
const User = require('../models/User');
const LdapProfile = require('../models/LdapProfile');
const Guest = require('../models/Guest');
const Week = require('../models/Week');
const { formatJalaliDate, parseJalaliDate, endOfJalaliDay, startOfDay, daysInJalaliMonth } = require('../helpers/DateHelper');
const { escapeRegex } = require('../helpers/SecurityHelper');
const { resolveClientIp } = require('../helpers/ClientIpHelper');
const { writeSecurityLog } = require('./SecurityLogService');

const CODE_RE = /^[A-Z0-9-]{4,24}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون حروف/ارقام مشابه (O/0، I/1)
const USE_STATUSES = ['paid', 'review'];
const PENDING_HOLD_MS = 30 * 60 * 1000;

function httpError(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 24);
}

function generateCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

// ── محافظ brute-force (کانال جدا: به ازای کاربر و IP) ──────────────────────
const FAIL_WINDOW_MS = 30 * 60 * 1000;
const FAIL_LIMIT = 8;
const BLOCK_MS = 30 * 60 * 1000;
const failures = new Map(); // key → { count, resetAt, blockedUntil }

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failures) {
    if (now > entry.resetAt && now > (entry.blockedUntil || 0)) failures.delete(key);
  }
}, 5 * 60 * 1000).unref();

function guardKeys(req, userKey) {
  return [`u:${userKey}`, `ip:${resolveClientIp(req)}`];
}

function assertNotBlocked(req, userKey) {
  const now = Date.now();
  for (const key of guardKeys(req, userKey)) {
    const entry = failures.get(key);
    if (entry?.blockedUntil && entry.blockedUntil > now) {
      const minutes = Math.ceil((entry.blockedUntil - now) / 60000);
      throw httpError(`به‌دلیل تلاش‌های ناموفق زیاد، ورود کد تخفیف تا ${minutes.toLocaleString('fa-IR')} دقیقه دیگر غیرفعال است`, 429, 'discount_blocked');
    }
  }
}

function recordFailure(req, userKey, code) {
  const now = Date.now();
  let blocked = false;
  for (const key of guardKeys(req, userKey)) {
    let entry = failures.get(key);
    if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + FAIL_WINDOW_MS, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= FAIL_LIMIT) {
      entry.blockedUntil = now + BLOCK_MS;
      entry.count = 0;
      blocked = true;
    }
    failures.set(key, entry);
  }
  writeSecurityLog(req, blocked ? 'discount_code_blocked' : 'discount_code_failed', { username: userKey }, 'کد تخفیف نامعتبر', {
    code: String(code || '').slice(0, 24),
  });
}

// ── بازه دوره ──────────────────────────────────────────────────────────────
async function periodBounds(code) {
  if (code.periodType === 'week' && mongoose.isValidObjectId(code.periodKey)) {
    const week = await Week.findById(code.periodKey).select('startDate endDate').lean();
    if (!week) return null;
    return { start: startOfDay(week.startDate), end: startOfDay(week.endDate) };
  }
  if (code.periodType === 'month') {
    const m = String(code.periodKey).match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const mm = String(month).padStart(2, '0');
    const start = parseJalaliDate(`${year}/${mm}/01`);
    const end = parseJalaliDate(`${year}/${mm}/${String(daysInJalaliMonth(year, month)).padStart(2, '0')}`);
    return start && end ? { start: startOfDay(start), end: startOfDay(end) } : null;
  }
  return { start: null, end: null };
}

async function userDepartmentIds(user = {}) {
  if (user.authSource === 'guest') return [];
  if (user.authSource === 'ldap' || String(user.id || '').startsWith('ldap:')) {
    const profile = await LdapProfile.findOne({ ldapUsername: String(user.username || '').toLowerCase() })
      .select('departmentId department').lean();
    if (profile?.departmentId) return [String(profile.departmentId)];
    const name = String(profile?.department || user.department || '').trim();
    if (!name) return [];
    const dept = await Department.findOne({ name }).select('_id').lean();
    return dept ? [String(dept._id)] : [];
  }
  if (!mongoose.isValidObjectId(user.id)) return [];
  const dbUser = await User.findById(user.id).select('departmentId').lean();
  return dbUser?.departmentId ? [String(dbUser.departmentId)] : [];
}

async function usageCounts(code, userKey) {
  const holdSince = new Date(Date.now() - PENDING_HOLD_MS);
  const used = {
    discountCodeId: code._id,
    $or: [{ status: { $in: USE_STATUSES } }, { status: 'initiated', createdAt: { $gte: holdSince } }],
  };
  const [total, mine] = await Promise.all([
    code.maxUses > 0 ? Payment.countDocuments(used) : 0,
    code.perPersonLimit > 0 ? Payment.countDocuments({ ...used, userKey }) : 0,
  ]);
  return { total, mine };
}

/**
 * ارزیابی کد برای یک پرداخت.
 * checkout = { amount, items: [{ amount, reportDate }] } (خروجی prepareCheckout)
 * ownerKeys = همه کلیدهای مالی این کاربر (برای مخاطب «یک نفر»)
 */
async function evaluateDiscount(req, { user, userKey, ownerKeys = [], code: rawCode, checkout }) {
  assertNotBlocked(req, userKey);
  const codeText = normalizeCode(rawCode);
  const generic = 'کد تخفیف نامعتبر است یا برای شما قابل استفاده نیست';
  const code = CODE_RE.test(codeText) ? await DiscountCode.findOne({ code: codeText, isActive: true }).lean() : null;

  let audienceOk = !!code;
  if (code?.audience === 'person') audienceOk = ownerKeys.includes(code.personKey);
  if (code?.audience === 'department') {
    audienceOk = !!code.departmentId && (await userDepartmentIds(user)).includes(String(code.departmentId));
  }
  if (!code || !audienceOk) {
    recordFailure(req, userKey, codeText);
    throw httpError(generic, 400, 'discount_invalid');
  }

  const now = Date.now();
  if (code.startsAt && new Date(code.startsAt).getTime() > now) throw httpError('این کد تخفیف هنوز فعال نشده است', 400, 'discount_not_started');
  if (new Date(code.expiresAt).getTime() < now) throw httpError('مهلت استفاده از این کد تخفیف تمام شده است', 400, 'discount_expired');

  const { total, mine } = await usageCounts(code, userKey);
  if (code.maxUses > 0 && total >= code.maxUses) throw httpError('ظرفیت استفاده از این کد تخفیف تکمیل شده است', 400, 'discount_used_up');
  if (code.perPersonLimit > 0 && mine >= code.perPersonLimit) throw httpError('شما قبلاً از این کد تخفیف استفاده کرده‌اید', 400, 'discount_used');

  // فقط سفارش‌هایی که تاریخ تحویلشان در دوره کد است
  const bounds = await periodBounds(code);
  if (!bounds) throw httpError('دوره این کد تخفیف معتبر نیست', 400, 'discount_period');
  const eligible = (checkout.items || []).filter((item) => {
    if (!bounds.start) return true;
    const d = startOfDay(item.reportDate).getTime();
    return d >= bounds.start.getTime() && d <= bounds.end.getTime();
  });
  const base = eligible.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (base <= 0) {
    throw httpError(`این کد تخفیف فقط برای ${code.periodLabel || 'دوره مشخص'} معتبر است`, 400, 'discount_period');
  }

  let discount = code.type === 'percent'
    ? Math.round(base * Math.min(100, code.value) / 100)
    : Math.min(code.value, base);
  if (code.type === 'percent' && code.maxDiscount > 0) discount = Math.min(discount, code.maxDiscount);
  discount = Math.max(0, Math.min(discount, Number(checkout.amount || 0)));

  return {
    codeId: code._id,
    code: code.code,
    title: code.title,
    label: code.type === 'percent' ? `${code.value.toLocaleString('fa-IR')}٪` : `${code.value.toLocaleString('fa-IR')} تومان`,
    discountAmount: discount,
    grossAmount: Number(checkout.amount || 0),
    netAmount: Math.max(0, Number(checkout.amount || 0) - discount),
  };
}

// ── مدیریت (پنل مالی) ──────────────────────────────────────────────────────

async function resolvePeriod(body) {
  const type = ['week', 'month'].includes(body.periodType) ? body.periodType : 'any';
  if (type === 'week') {
    if (!mongoose.isValidObjectId(body.periodKey)) throw httpError('هفته را انتخاب کنید');
    const week = await Week.findById(body.periodKey).select('startDate endDate').lean();
    if (!week) throw httpError('هفته یافت نشد', 404);
    return { periodType: 'week', periodKey: String(week._id), periodLabel: `هفته ${formatJalaliDate(week.startDate)} تا ${formatJalaliDate(week.endDate)}` };
  }
  if (type === 'month') {
    const m = String(body.periodKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw httpError('ماه را انتخاب کنید');
    const names = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
    return { periodType: 'month', periodKey: `${m[1]}-${m[2]}`, periodLabel: `ماه ${names[Number(m[2]) - 1]} ${m[1]}` };
  }
  return { periodType: 'any', periodKey: '', periodLabel: 'همه دوره‌ها' };
}

async function resolveAudience(body) {
  if (body.audience === 'department') {
    if (!mongoose.isValidObjectId(body.departmentId)) throw httpError('واحد را انتخاب کنید');
    const dept = await Department.findById(body.departmentId).select('name').lean();
    if (!dept) throw httpError('واحد یافت نشد', 404);
    return { audience: 'department', departmentId: dept._id, departmentName: dept.name, personKey: '', personLabel: '' };
  }
  if (body.audience === 'person') {
    const key = String(body.personKey || '').trim();
    if (!key) throw httpError('فرد را انتخاب کنید');
    const people = await searchPeople('', key);
    if (!people.length) throw httpError('فرد انتخاب‌شده یافت نشد', 404);
    return { audience: 'person', departmentId: null, departmentName: '', personKey: key, personLabel: people[0].label };
  }
  return { audience: 'all', departmentId: null, departmentName: '', personKey: '', personLabel: '' };
}

function parseExpiry(value) {
  const raw = String(value || '').trim();
  const date = endOfJalaliDay(raw) || (raw ? new Date(raw) : null);
  if (!date || Number.isNaN(date.getTime())) throw httpError('تاریخ انقضا نامعتبر است');
  if (date.getTime() <= Date.now()) throw httpError('تاریخ انقضا باید در آینده باشد');
  return date;
}

async function createCode(body = {}, actor = {}) {
  const code = normalizeCode(body.code) || generateCode();
  if (!CODE_RE.test(code)) throw httpError('کد تخفیف باید ۴ تا ۲۴ کاراکتر از حروف انگلیسی، عدد یا خط تیره باشد');
  if (code.length < 6 && body.audience !== 'person') {
    throw httpError('برای کدهای عمومی/واحدی حداقل ۶ کاراکتر لازم است (حدس‌زدن سخت‌تر شود)');
  }
  const type = body.type === 'fixed' ? 'fixed' : 'percent';
  const value = Math.round(Number(body.value));
  if (!Number.isFinite(value) || value < 1 || (type === 'percent' && value > 100)) {
    throw httpError(type === 'percent' ? 'درصد تخفیف باید بین ۱ تا ۱۰۰ باشد' : 'مبلغ تخفیف نامعتبر است');
  }
  try {
    return await DiscountCode.create({
      code,
      title: String(body.title || '').trim().slice(0, 120),
      type,
      value,
      maxDiscount: type === 'percent' ? Math.max(0, Math.round(Number(body.maxDiscount) || 0)) : 0,
      ...(await resolveAudience(body)),
      ...(await resolvePeriod(body)),
      startsAt: new Date(),
      expiresAt: parseExpiry(body.expiresAt),
      maxUses: Math.max(0, Math.round(Number(body.maxUses) || 0)),
      perPersonLimit: body.perPersonLimit === undefined ? 1 : Math.max(0, Math.round(Number(body.perPersonLimit) || 0)),
      isActive: true,
      createdBy: actor.username || '',
    });
  } catch (error) {
    if (Number(error?.code) === 11000) throw httpError('این کد تخفیف قبلاً ثبت شده است', 409);
    throw error;
  }
}

async function listCodes() {
  const codes = await DiscountCode.find().sort({ createdAt: -1 }).limit(500).lean();
  if (!codes.length) return [];
  const stats = await Payment.aggregate([
    { $match: { discountCodeId: { $in: codes.map((c) => c._id) }, status: { $in: USE_STATUSES } } },
    { $group: { _id: '$discountCodeId', uses: { $sum: 1 }, total: { $sum: '$discountAmount' } } },
  ]);
  const byId = new Map(stats.map((s) => [String(s._id), s]));
  const now = Date.now();
  return codes.map((c) => ({
    ...c,
    uses: byId.get(String(c._id))?.uses || 0,
    totalDiscount: byId.get(String(c._id))?.total || 0,
    expired: new Date(c.expiresAt).getTime() < now,
  }));
}

async function setActive(id, isActive) {
  if (!mongoose.isValidObjectId(id)) throw httpError('کد یافت نشد', 404);
  const doc = await DiscountCode.findByIdAndUpdate(id, { $set: { isActive: !!isActive } }, { new: true }).lean();
  if (!doc) throw httpError('کد یافت نشد', 404);
  return doc;
}

async function removeCode(id) {
  if (!mongoose.isValidObjectId(id)) throw httpError('کد یافت نشد', 404);
  const doc = await DiscountCode.findByIdAndDelete(id).lean();
  if (!doc) throw httpError('کد یافت نشد', 404);
  return doc;
}

/** جستجوی افراد برای مخاطب «یک نفر»: کاربران محلی، کاربران AD و مهمان‌ها */
async function searchPeople(q = '', exactKey = '') {
  const results = [];
  if (exactKey) {
    if (exactKey.startsWith('guest:')) {
      const id = exactKey.slice(6);
      const g = mongoose.isValidObjectId(id) ? await Guest.findById(id).select('fullName guestCode').lean() : null;
      if (g) results.push({ key: exactKey, label: `${g.fullName} (مهمان ${g.guestCode})`, kind: 'guest' });
    } else if (exactKey.startsWith('ldap:')) {
      const name = exactKey.slice(5);
      const p = await LdapProfile.findOne({ ldapUsername: name.toLowerCase() }).select('fullName ldapUsername').lean();
      const u = p ? null : await User.findOne({ username: name }).select('fullName username').lean();
      if (p || u) results.push({ key: exactKey, label: `${(p || u).fullName || name} (${name})`, kind: 'ldap' });
    } else if (mongoose.isValidObjectId(exactKey)) {
      const u = await User.findById(exactKey).select('fullName username').lean();
      if (u) results.push({ key: exactKey, label: `${u.fullName || u.username} (${u.username})`, kind: 'user' });
    }
    return results;
  }
  const term = String(q || '').trim().slice(0, 60);
  if (term.length < 2) return [];
  const rx = new RegExp(escapeRegex(term), 'i');
  const [users, profiles, guests] = await Promise.all([
    User.find({ $or: [{ username: rx }, { fullName: rx }] }).select('fullName username ldapUser').limit(10).lean(),
    LdapProfile.find({ $or: [{ ldapUsername: rx }, { fullName: rx }] }).select('fullName ldapUsername').limit(10).lean(),
    Guest.find({ $or: [{ fullName: rx }, { guestCode: term }] }).select('fullName guestCode').limit(10).lean(),
  ]);
  const seen = new Set();
  for (const u of users) {
    const key = u.ldapUser ? `ldap:${u.username}` : String(u._id);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ key, label: `${u.fullName || u.username} (${u.username})`, kind: u.ldapUser ? 'ldap' : 'user' });
  }
  for (const p of profiles) {
    const key = `ldap:${p.ldapUsername}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ key, label: `${p.fullName || p.ldapUsername} (${p.ldapUsername})`, kind: 'ldap' });
  }
  for (const g of guests) results.push({ key: `guest:${g._id}`, label: `${g.fullName} (مهمان ${g.guestCode})`, kind: 'guest' });
  return results.slice(0, 20);
}

module.exports = {
  normalizeCode,
  generateCode,
  evaluateDiscount,
  createCode,
  listCodes,
  setActive,
  removeCode,
  searchPeople,
};
