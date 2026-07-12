function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

function allowedOrigins(req) {
  const configured = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  const appUrl = process.env.APP_URL ? normalizeOrigin(process.env.APP_URL) : '';
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  return new Set([requestOrigin, appUrl, ...configured].filter(Boolean));
}

function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  const presented = origin ? normalizeOrigin(origin) : normalizeOrigin(referer || '');

  // Same-origin browser requests should carry Origin or Referer on mutating calls.
  // Non-browser clients must use an Authorization bearer token, not ambient cookies.
  if (!presented) {
    if (req.headers.authorization?.startsWith('Bearer ')) return next();
    return res.status(403).json({ success: false, message: 'درخواست بدون مبدا معتبر رد شد' });
  }

  if (!allowedOrigins(req).has(presented)) {
    return res.status(403).json({ success: false, message: 'مبدا درخواست مجاز نیست' });
  }

  next();
}

module.exports = originGuard;
