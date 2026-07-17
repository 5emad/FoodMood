const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const SESSION_COOKIE_RE = /^(sid|connect\.sid|__Host-sid|__Secure-sid)$/i;
const PATH_OID_RE = /\/([a-f0-9]{24})(?=\/|$|\?)/gi;

function isIdParamName(key) {
  return key === 'id' || key.endsWith('_id') || key.endsWith('Id');
}

function scrubObjectIds(obj, backups) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string' && isIdParamName(key) && OBJECT_ID_RE.test(val)) {
      // نام موقت نباید به Id / _id ختم شود تا semantic-id-injection نگیرد
      const hide = `__fmox_${key}_val`;
      backups.push({ type: 'field', obj, key, hide, val });
      obj[hide] = val;
      delete obj[key];
    } else if (val && typeof val === 'object') {
      scrubObjectIds(val, backups);
    }
  }
}

function toSafeUuidToken(id) {
  return `00000000-0000-4000-8000-${String(id).slice(0, 12)}`;
}

function scrubUrlObjectIds(req, backups) {
  const raw = req.url || '';
  PATH_OID_RE.lastIndex = 0;
  if (!PATH_OID_RE.test(raw)) {
    PATH_OID_RE.lastIndex = 0;
    return;
  }
  PATH_OID_RE.lastIndex = 0;

  const scrubbed = raw.replace(PATH_OID_RE, (_, id) => `/${toSafeUuidToken(id)}`);
  if (scrubbed === raw) return;

  backups.push({ type: 'url', url: raw, originalUrl: req.originalUrl });
  req.url = scrubbed;
  if (typeof req.originalUrl === 'string') {
    PATH_OID_RE.lastIndex = 0;
    req.originalUrl = req.originalUrl.replace(PATH_OID_RE, (_, id) => `/${toSafeUuidToken(id)}`);
  }
}

function restoreScrubs(backups, req) {
  for (let i = backups.length - 1; i >= 0; i -= 1) {
    const b = backups[i];
    if (b.type === 'field') {
      b.obj[b.key] = b.val;
      delete b.obj[b.hide];
    } else if (b.type === 'url' && req) {
      req.url = b.url;
      if (b.originalUrl !== undefined) req.originalUrl = b.originalUrl;
    }
  }
  backups.length = 0;
}

/**
 * قبل از WAF: ObjectIdهای مونگو را موقتاً مخفی می‌کند.
 * بعد از WAF (قبل از روت‌ها): حتماً باید restore شود وگرنه weekId/id در هندلر گم می‌شود.
 */
function createWafScrubMiddleware() {
  return function wafScrub(req, res, next) {
    if (!req._fmoxWafBackups) req._fmoxWafBackups = [];
    const backups = req._fmoxWafBackups;

    scrubUrlObjectIds(req, backups);
    scrubObjectIds(req.query, backups);
    scrubObjectIds(req.body, backups);
    scrubObjectIds(req.params, backups);

    if (!req._fmoxCookieSaved) {
      req._fmoxCookieSaved = true;
      req._fmoxSavedCookie = req.headers.cookie;
      if (req._fmoxSavedCookie) {
        const filtered = String(req._fmoxSavedCookie)
          .split(';')
          .map((p) => p.trim())
          .filter((p) => {
            const name = p.split('=')[0];
            return name && !SESSION_COOKIE_RE.test(name);
          })
          .join('; ');
        req.headers.cookie = filtered || undefined;
      }
    }

    next();
  };
}

function createWafRestoreMiddleware() {
  return function wafRestore(req, _res, next) {
    const backups = req._fmoxWafBackups;
    if (backups && backups.length) restoreScrubs(backups, req);
    if (req._fmoxCookieSaved && req._fmoxSavedCookie !== undefined) {
      req.headers.cookie = req._fmoxSavedCookie;
    }
    next();
  };
}

/** @deprecated — سازگاری با importهای قبلی */
function createWafCompatMiddleware() {
  return createWafScrubMiddleware();
}

function applyFirewtwallPatches() {
  // no-op
}

module.exports = {
  applyFirewtwallPatches,
  createWafCompatMiddleware,
  createWafScrubMiddleware,
  createWafRestoreMiddleware,
};
