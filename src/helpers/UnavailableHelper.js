const { isSuperadminRequest } = require('./AuthCookieHelper');

const PUBLIC_UNAVAILABLE_PATHS = new Set([
  '/css/unavailable.css',
  '/css/theme-vars.css',
  '/favicon.ico',
]);

function isSuperadminSession(req) {
  return isSuperadminRequest(req);
}

function isPublicUnavailableAsset(req) {
  const p = req.path || '';
  if (PUBLIC_UNAVAILABLE_PATHS.has(p)) return true;
  if (p.startsWith('/vendor/')) return true;
  if (p.startsWith('/fonts/')) return true;
  if (p.startsWith('/css/')) return true;
  if (p.startsWith('/js/')) return true;
  if (/\.(woff2?|ttf|eot|ico|css|js|map|png|jpe?g|gif|svg|webp)$/i.test(p)) return true;
  if (p.startsWith('/js/unavailable-ambient.js')) return true;
  return false;
}

function wantsHtml(req) {
  return req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/');
}

function renderUnavailable(req, res, status = 503) {
  res.status(status);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Retry-After', '120');
  if (wantsHtml(req)) {
    return res.render('errors/unavailable');
  }
  return res.json({
    success: false,
    code: 'SERVICE_UNAVAILABLE',
    message: 'در حال حاضر سامانه تغذیه در دسترس نمی‌باشد',
  });
}

module.exports = {
  isSuperadminSession,
  isPublicUnavailableAsset,
  renderUnavailable,
  wantsHtml,
};
