/**
 * Simple in-memory rate limiter — no external package needed.
 * Uses a sliding window counter per (limiter-instance, key) pair.
 * NOTE: resets on server restart; use Redis for multi-instance deployments.
 */

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
    const key = (keyGenerator ? keyGenerator(req) : null) || req.ip || 'unknown';
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
  keyGenerator:   (req) => req.ip || req.connection?.remoteAddress || 'unknown',
});

const apiLimiter = createLimiter({
  windowMs: 60 * 1000,
  max:      200,
  message:  { success: false, message: 'درخواست‌های زیادی ارسال کردید. لطفاً کمی صبر کنید.' },
});

const superTokenLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'تعداد تلاش برای توکن امنیتی بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.' },
  keyGenerator: (req) => `${req.ip || req.connection?.remoteAddress || 'unknown'}:${req.session?.pendingSuperLogin?.userId || 'none'}`,
});

const backupRestoreLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { success: false, message: 'تعداد بازیابی پشتیبان در ساعت بیش از حد مجاز است.' },
  keyGenerator: (req) => `${req.ip || 'unknown'}:${req.user?.id || req.session?.userId || 'anon'}`,
});

module.exports = { loginLimiter, apiLimiter, superTokenLimiter, backupRestoreLimiter };
