const { normalizePublicUrl, requestOrigin } = require('../helpers/AppUrlHelper');
const {
  refreshOriginPublicUrlCache,
  isOriginAllowed,
  isAuthApiPath,
} = require('../helpers/OriginPolicyHelper');

async function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (isAuthApiPath(req)) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  const presented = origin ? normalizePublicUrl(origin) : normalizePublicUrl(referer || '');

  if (!presented) {
    if (req.headers.authorization?.startsWith('Bearer ')) return next();
    return res.status(403).json({ success: false, message: 'درخواست بدون مبدا معتبر رد شد' });
  }

  if (!isOriginAllowed(presented, req)) {
    return res.status(403).json({ success: false, message: 'مبدا درخواست مجاز نیست' });
  }

  next();
}

module.exports = originGuard;
module.exports.refreshOriginPublicUrlCache = refreshOriginPublicUrlCache;
