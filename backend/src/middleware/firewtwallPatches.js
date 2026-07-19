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

/**
 * ObjectId کامل ۲۴ هگز را داخل یک UUID v4-مانند جا می‌دهد تا WAF رد نکند
 * و در صورت نیاز بتوان id را از توکن بازیابی کرد (restore URL اولویت دارد).
 */
function toSafeUuidToken(id) {
  const hex = String(id).toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-8${hex.slice(15, 18)}-${hex.slice(18, 24)}00`;
}

function fromSafeUuidToken(token) {
  const m = String(token || '').toLowerCase().match(
    /^([a-f0-9]{8})-([a-f0-9]{4})-4([a-f0-9]{3})-8([a-f0-9]{3})-([a-f0-9]{6})00$/,
  );
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`;
}

function scrubUrlObjectIds(req, backups) {
  const raw = req.url || '';
  PATH_OID_RE.lastIndex = 0;
  if (!PATH_OID_RE.test(raw)) {
    PATH_OID_RE.lastIndex = 0;
    return;
  }
  PATH_OID_RE.lastIndex = 0;

  const idMap = [];
  const scrubbed = raw.replace(PATH_OID_RE, (_, id) => {
    const token = toSafeUuidToken(id);
    idMap.push({ token, id });
    return `/${token}`;
  });
  if (scrubbed === raw) return;

  backups.push({ type: 'url', url: raw, originalUrl: req.originalUrl, idMap });
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

/** بعد از match شدن روت، params ممکن است هنوز توکن UUID داشته باشد — به ObjectId برگردان */
function restoreParamsObjectIds(req) {
  if (!req?.params || typeof req.params !== 'object') return;
  for (const key of Object.keys(req.params)) {
    if (!isIdParamName(key)) continue;
    const val = req.params[key];
    if (typeof val !== 'string' || OBJECT_ID_RE.test(val)) continue;
    const restored = fromSafeUuidToken(val);
    if (restored && OBJECT_ID_RE.test(restored)) req.params[key] = restored;
  }
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
    // params معمولاً هنوز خالی است؛ بعد از روت هم یک‌بار چک می‌کنیم
    restoreParamsObjectIds(req);
    next();
  };
}

/** بعد از روت‌ها — اگر به هر دلیل params هنوز توکن باشد، ObjectId را برگردان */
function createWafParamsRestoreMiddleware() {
  return function wafParamsRestore(req, _res, next) {
    restoreParamsObjectIds(req);
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
  createWafParamsRestoreMiddleware,
};
