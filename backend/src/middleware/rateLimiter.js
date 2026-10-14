/**
 * Simple in-memory rate limiter — no external package needed.
 * Uses a sliding window counter per (limiter-instance, key) pair.
 * NOTE: resets on server restart; use Redis for multi-instance deployments.
 */

const { directClientIp, resolveClientIp } = require('../helpers/ClientIpHelper');

function createLimiter({ windowMs, max, message, keyGenerator, skipSuccessful = false }) {
  // Each limiter instance gets its own isolated store so counters don't bleed
  // between limiters that share a route (e.g. loginLimiter + apiLimiter on /api/auth/login).
  const store = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 60 * 1000).unref();

  return (req, res, next) => {
    const key = (keyGenerator ? keyGenerator(req) : null) || resolveClientIp(req);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;

    res.setHeader('RateLimit-Limit',     String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.setHeader('RateLimit-Reset',     String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      const payload = typeof message === 'object' ? message : { success: false, message };
      return res.status(429).json(payload);
    }

    if (skipSuccessful) {
      const origEnd = res.end.bind(res);
      res.end = function (...args) {
        if (res.statusCode < 400) entry.count = Math.max(0, entry.count - 1);
        return origEnd(...args);
      };
    }

    next();
  };
}

const loginLimiter = createLimiter({
  windowMs:       15 * 60 * 1000,
  max:            10,
  skipSuccessful: true,
  message:        { success: false, message: 'تعداد تلاش‌های ورود بیش از حد مجاز است. ۱۵ دقیقه دیگر تلاش کنید.' },
  keyGenerator:   (req) => resolveClientIp(req),
});

const apiLimiter = createLimiter({
  windowMs: 60 * 1000,
  max:      Number(process.env.API_RATE_LIMIT_MAX || 400),
  message:  { success: false, message: 'درخواست‌های زیادی ارسال کردید. لطفاً کمی صبر کنید.' },
  keyGenerator: (req) => resolveClientIp(req),
});

const superTokenLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.SUPER_TOKEN_RATE_LIMIT_MAX || 10),
  skipSuccessful: true,
  message: { success: false, message: 'تعداد تلاش برای توکن امنیتی بیش از حد مجاز است. ۱۰ دقیقه دیگر تلاش کنید.' },
  keyGenerator: (req) => `${resolveClientIp(req)}:${req.session?.pendingSuperLogin?.userId || 'none'}`,
});

/** ثبت‌نام عمومی: هر IP حداکثر ۵ تلاش در ساعت */
const registerLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.REGISTER_RATE_LIMIT_MAX || 5),
  message: { success: false, message: 'تعداد تلاش برای ثبت‌نام بیش از حد مجاز است. یک ساعت دیگر تلاش کنید.' },
  keyGenerator: (req) => `register:${resolveClientIp(req)}`,
});

/** تولید تصویر کپچا */
const captchaLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.CAPTCHA_RATE_LIMIT_MAX || 60),
  message: { success: false, message: 'درخواست کد امنیتی بیش از حد مجاز است. کمی صبر کنید.' },
  keyGenerator: (req) => `captcha:${resolveClientIp(req)}`,
});

/** تغییر رمز: جلوی حدس رمز فعلی با یک نشست ربوده‌شده را می‌گیرد */
const passwordChangeLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessful: true,
  message: { success: false, message: 'تعداد تلاش برای تغییر رمز بیش از حد مجاز است. ۱۵ دقیقه دیگر تلاش کنید.' },
  keyGenerator: (req) => `pwchange:${req.user?.id || resolveClientIp(req)}`,
});

/** عملیات حجیم/حساس ادمین (حذف گروهی و ...) */
const bulkActionLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: 'تعداد عملیات گروهی بیش از حد مجاز است. کمی صبر کنید.' },
  keyGenerator: (req) => `bulk:${req.user?.id || resolveClientIp(req)}`,
});

const backupRestoreLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.BACKUP_RESTORE_RATE_LIMIT_MAX || 20),
  message: { success: false, message: 'تعداد بازیابی پشتیبان در ساعت بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.' },
  keyGenerator: (req) => `${resolveClientIp(req)}:${req.user?.id || req.session?.userId || 'anon'}`,
});

/** ساخت پرداخت (هر بار درگاه/بله را صدا می‌زند) — به ازای کاربر */
const paymentCreateLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.PAYMENT_CREATE_RATE_LIMIT_MAX || 10),
  message: { success: false, message: 'تعداد درخواست پرداخت بیش از حد مجاز است. کمی صبر کنید.' },
  keyGenerator: (req) => `pay:${req.user?.id || resolveClientIp(req)}`,
});

/** صفحه‌های پرداخت بدون نشست (/payment/*) و بازگشت درگاه — به ازای IP */
const paymentPageLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.PAYMENT_PAGE_RATE_LIMIT_MAX || 120),
  message: { success: false, message: 'تعداد درخواست‌ها بیش از حد مجاز است.' },
});

/** وب‌هوک بله */
const webhookLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.WEBHOOK_RATE_LIMIT_MAX || 300),
  message: { ok: false },
});

/**
 * کانال ورود مهمان — جدا از ورود کارکنان (store و سقف جدا).
 * ورود ناموفق: به ازای IP؛ قفل ۵ تلاش برای هر مهمان هم جداگانه اعمال می‌شود.
 */
const guestLoginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.GUEST_LOGIN_RATE_LIMIT_MAX || 10),
  skipSuccessful: true,
  message: { success: false, message: 'تعداد تلاش‌های ورود مهمان بیش از حد مجاز است. ۱۵ دقیقه بعد دوباره تلاش کنید.' },
  keyGenerator: (req) => `guest-login:${resolveClientIp(req)}`,
});

const guestCaptchaLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.GUEST_CAPTCHA_RATE_LIMIT_MAX || 40),
  message: { success: false, message: 'درخواست کد امنیتی بیش از حد مجاز است.' },
  keyGenerator: (req) => `guest-captcha:${resolveClientIp(req)}`,
});

const guestMagicLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.GUEST_MAGIC_RATE_LIMIT_MAX || 15),
  skipSuccessful: true,
  message: { success: false, message: 'تعداد تلاش‌ها بیش از حد مجاز است.' },
  keyGenerator: (req) => `guest-magic:${resolveClientIp(req)}`,
});

/** بررسی کد تخفیف — کانال جدا؛ قفل ۸ تلاش ناموفق در DiscountCodeService */
const discountCheckLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.DISCOUNT_CHECK_RATE_LIMIT_MAX || 20),
  message: { success: false, message: 'تعداد بررسی کد تخفیف بیش از حد مجاز است. کمی صبر کنید.' },
  keyGenerator: (req) => `discount:${req.user?.id || resolveClientIp(req)}`,
});

module.exports = {
  discountCheckLimiter,
  guestLoginLimiter,
  guestCaptchaLimiter,
  guestMagicLimiter,
  paymentCreateLimiter,
  paymentPageLimiter,
  webhookLimiter,
  loginLimiter,
  apiLimiter,
  superTokenLimiter,
  registerLimiter,
  captchaLimiter,
  passwordChangeLimiter,
  bulkActionLimiter,
  backupRestoreLimiter,
  directClientIp,
  resolveClientIp,
};
