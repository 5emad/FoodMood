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
    restoreParamsObjectIds(req);
    next();
  };
}

function createWafParamsRestoreMiddleware() {
  return function wafParamsRestore(req, _res, next) {
    restoreParamsObjectIds(req);
    next();
  };
}

function createWafCompatMiddleware() {
  return createWafScrubMiddleware();
}

/**
 * firewtwall/requestSize با req.on('data') استریم را flowing می‌کند و قبل از multer
 * بدنه multipart را می‌خورد → "Unexpected end of form".
 * برای multipart / مسیرهای trusted فقط Content-Length را چک می‌کنیم.
 */
function createMultipartSafeRequestSizeMiddleware(config) {
  const maxBytes = Number(config?.maxBodySize) || (6 * 1024 * 1024);
  return function requestSizeMiddleware(req, res, next) {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
      return res.status(413).json({
        blocked: true,
        rule: 'request-size',
        message: 'Request entity too large',
      });
    }

    const contentType = String(req.headers['content-type'] || '');
    // Multer needs an untouched stream; flowing data listeners break multipart parsing.
    if (req.wafTrusted || contentType.includes('multipart/form-data')) {
      return next();
    }

    let received = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      received += chunk.length;
      if (received > maxBytes) {
        aborted = true;
        req.destroy();
        if (!res.headersSent) {
          res.status(413).json({
            blocked: true,
            rule: 'request-size',
            message: 'Request entity too large',
          });
        }
      }
    });
    return next();
  };
}

/**
 * توجه: firewtwall فقط "." را export می‌کند؛ require.resolve('firewtwall/middleware/...')
 * با ERR_PACKAGE_PATH_NOT_EXPORTED شکست می‌خورد — باید از مسیر فایل مطلق استفاده کرد.
 * این پچ باید قبل از اولین require('firewtwall') صدا زده شود.
 */
function patchRequestSizeForMultipart() {
  const path = require('path');
  let requestSizePath;
  try {
    const wafRoot = path.dirname(require.resolve('firewtwall'));
    requestSizePath = path.join(wafRoot, 'middleware', 'requestSize.js');
  } catch {
    return;
  }

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const original = require(requestSizePath);
  if (original?.__fmoxMultipartSafe) return;

  const factory = function createRequestSizeMiddleware(config) {
    return createMultipartSafeRequestSizeMiddleware(config);
  };
  factory.__fmoxMultipartSafe = true;
  require.cache[requestSizePath].exports = factory;
}

function applyFirewtwallPatches() {
  patchRequestSizeForMultipart();
}

module.exports = {
  applyFirewtwallPatches,
  createMultipartSafeRequestSizeMiddleware,
  createWafCompatMiddleware,
  createWafScrubMiddleware,
  createWafRestoreMiddleware,
  createWafParamsRestoreMiddleware,
};
