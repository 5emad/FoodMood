const {
  getConfiguredPublicUrl,
  requestOrigin,
  shouldEnforceCanonicalHost,
  isLocalOrigin,
  shouldSkipCanonicalRedirect,
  buildAppPath,
  prefersHttps,
} = require('../helpers/AppUrlHelper');

async function appUrlMiddleware(req, res, next) {
  try {
    const configured = await getConfiguredPublicUrl();
    const current = requestOrigin(req);
    res.locals.publicUrl = configured || current;
    res.locals.clientBaseUrl = current || configured || '';
    res.locals.appUrl = (path) => {
      const base = res.locals.publicUrl || '';
      const normalized = buildAppPath(path);
      return base ? `${base.replace(/\/$/, '')}${normalized}` : normalized;
    };
    next();
  } catch {
    res.locals.publicUrl = requestOrigin(req);
    res.locals.clientBaseUrl = requestOrigin(req) || '';
    res.locals.appUrl = (path) => buildAppPath(path);
    next();
  }
}

async function canonicalHostMiddleware(req, res, next) {
  if (shouldSkipCanonicalRedirect(req)) return next();
  if (!shouldEnforceCanonicalHost()) return next();

  try {
    const configured = await getConfiguredPublicUrl();
    const current = requestOrigin(req);
    if (!configured || configured === current) return next();
    if (!prefersHttps()) {
      try {
        const configuredUrl = new URL(configured);
        const currentUrl = new URL(current);
        if (configuredUrl.protocol !== currentUrl.protocol) return next();
      } catch {
        return next();
      }
    }
    if (process.env.NODE_ENV !== 'production' && isLocalOrigin(current) && process.env.FORCE_APP_URL !== 'true') {
      return next();
    }
    const target = `${configured.replace(/\/$/, '')}${req.originalUrl || '/'}`;
    return res.redirect(301, target);
  } catch {
    return next();
  }
}

module.exports = {
  appUrlMiddleware,
  canonicalHostMiddleware,
};
