const crypto = require('crypto');

function ensureCsrfToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

function csrfMiddleware(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const p = String(req.path || '');
  // Mounted at /api → path is /auth/...
  if (
    p === '/auth/login'
    || p === '/auth/resolve-username'
    || p === '/auth/verify-super-token'
    || p === '/auth/logout'
    || p.startsWith('/auth/login/')
  ) return next();

  // Bearer-token API clients are not using ambient browser cookies.
  if (req.headers.authorization?.startsWith('Bearer ')) return next();

  const expected = ensureCsrfToken(req);
  const provided = String(req.get('x-csrf-token') || '');
  if (!expected || provided !== expected) {
    return res.status(403).json({ success: false, message: 'نشست امنیتی منقضی شده. صفحه را تازه‌سازی کنید (F5) و دوباره تلاش کنید.', code: 'CSRF_INVALID' });
  }
  next();
}

module.exports = { ensureCsrfToken, csrfMiddleware };
