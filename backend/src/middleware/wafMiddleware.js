const path = require('path');
const { startWafLogBridge } = require('../services/WafLogBridge');
const { isWafRuntimeEnabled } = require('../services/WafStateService');
const {
  applyFirewtwallPatches,
  createMultipartSafeRequestSizeMiddleware,
  createWafScrubMiddleware,
  createWafRestoreMiddleware,
} = require('./firewtwallPatches');

// پچ باید قبل از require('firewtwall') اجرا شود؛ وگرنه factory اصلی در closure می‌ماند
applyFirewtwallPatches();
const { createWAF } = require('firewtwall');

const WAF_LOG_PATH = path.join(__dirname, '..', '..', 'logs', 'waf.log');

function envList(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return [];
  return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

/**
 * WAF برای FoodMood:
 * - سطح اپ (SPA / API / پنل / استاتیک / نشست لاگین‌شده) همیشه trusted است
 * - موتور فقط روی مسیرهای ناشناس/اسکنر سخت می‌گیرد
 * - auth + CSRF + rateLimiter اپ همچنان فعال‌اند
 */
const apiRateDefault = envInt('API_RATE_LIMIT_MAX', 800);

const WAF_OPTIONS = {
  // log-only = ثبت بدون بلاک؛ reject = بلاک. پیش‌فرض reject ولی با trust گسترده برای اپ.
  mode: String(process.env.WAF_MODE || 'reject').toLowerCase() === 'log-only' ? 'log-only' : 'reject',
  responseType: 'json',
  logPath: WAF_LOG_PATH,
  debug: process.env.WAF_DEBUG === 'true',

  maxBodySize: envInt('WAF_MAX_BODY_BYTES', 210 * 1024 * 1024),

  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],

  whitelist: envList('WAF_WHITELIST'),
  blacklist: envList('WAF_BLACKLIST'),

  trustedProxies: (() => {
    const fromEnv = envList('WAF_TRUSTED_PROXIES').length
      ? envList('WAF_TRUSTED_PROXIES')
      : envList('TRUSTED_PROXIES');
    const loopback = ['127.0.0.1', '::1'];
    if (!fromEnv.length) return loopback;
    const merged = new Set(fromEnv);
    for (const ip of loopback) merged.add(ip);
    return [...merged];
  })(),

  bypassPaths: [
    '/healthz',
    '/api/system/health',
    '/favicon.ico',
    '/',
    '/login',
    '/logout',
    '/complete-profile',
    '/foods',
    '/unavailable',
    '/service-unavailable',
  ],

  rateLimit: {
    windowMs: 60 * 1000,
    maxRequests: envInt('WAF_RATE_LIMIT_MAX', Math.max(apiRateDefault, 2000)),
    blockDurationMs: envInt('WAF_BLOCK_MS', 30 * 1000),
  },

  ddos: {
    maxUrlLength: 4096,
    maxHeaderCount: 80,
    maxHeaderSize: 8192,
    burst: {
      windowMs: 1000,
      maxRequests: envInt('WAF_BURST_MAX', 120),
      blockDurationMs: 15 * 1000,
    },
    global: {
      windowMs: 60_000,
      maxRequests: envInt('WAF_GLOBAL_MAX', 50_000),
    },
    fingerprint: {
      windowMs: 10_000,
      maxRequests: envInt('WAF_FP_MAX', 500),
      blockDurationMs: 15 * 1000,
    },
    pathFlood: {
      windowMs: 5_000,
      maxRequests: envInt('WAF_PATH_FLOOD_MAX', 2000),
    },
    tarpit: {
      // تارپیت برای ادمین واقعی فقط تاخیر می‌سازد — پیش‌فرض خاموش
      enabled: envFlag('WAF_TARPIT', false),
      delayMs: envInt('WAF_TARPIT_MS', 400),
    },
  },

  entropy: {
    minLength: 48,
    shellcodeThreshold: 7.2,
    encodedThreshold: 6.2,
    b64Threshold: 6.5,
  },

  heuristic: {
    encodingMixThreshold: 12,
    nestingDepthThreshold: 10,
    keywordDensityThreshold: 8,
    operatorStormThreshold: 40,
  },

  // عملاً خاموش برای UI واقعی (اسکنر فازی همچنان با آستانه خیلی بالا)
  mutation: {
    windowMs: 60_000,
    maxVariants: envInt('WAF_MUTATION_MAX', 80),
    levenshteinThreshold: 2,
    replayThreshold: envInt('WAF_REPLAY_MAX', 80),
  },

  rhythm: {
    sampleSize: 30,
    machineStddevThreshold: 5,
    burstWindowMs: 40,
    lowSlowJitterMs: 1,
  },
};

function normalizeReqPath(req) {
  const raw = String(req.originalUrl || req.url || req.path || '/').split('?')[0];
  if (!raw) return '/';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function hasAppSessionCookie(req) {
  const cookie = String(req.headers?.cookie || '');
  return /(?:^|;\s*)(?:sid|__Host-sid|__Secure-sid|connect\.sid)=/i.test(cookie);
}

/**
 * آیا این درخواست جزء سطح اپ است و نباید WAF بلاکش کند؟
 */
function isAppSurfacePath(p) {
  if (!p || p === '/') return true;
  const prefixes = [
    '/api/',
    '/admin',
    '/user',
    '/assets/',
    '/spa/',
    '/vendor/',
    '/css/',
    '/js/',
    '/login',
    '/logout',
    '/complete-profile',
    '/foods',
    '/unavailable',
    '/service-unavailable',
    '/healthz',
    '/favicon.ico',
  ];
  return prefixes.some((pre) => p === pre || p.startsWith(pre));
}

function createSafeWafResponseMiddleware() {
  return function safeWafResponse(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = function sanitizeWafJson(body) {
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const isWafBlock = body.blocked === true
          || (typeof body.rule === 'string' && /waf|blocked by waf/i.test(String(body.message || '')))
          || /Request blocked by WAF/i.test(String(body.message || ''));
        if (isWafBlock) {
          // اگر سطح اپ بود ولی به هر دلیل بلاک شد — عبور نرم (نباید UI ادمین بشکند)
          if (req.wafTrusted || isAppSurfacePath(normalizeReqPath(req))) {
            if (!res.statusCode || res.statusCode >= 400) res.status(200);
            return originalJson({
              success: false,
              message: 'درخواست توسط لایه امنیتی رد شد؛ دوباره تلاش کنید.',
              code: 'WAF_SOFT',
            });
          }
          if (!res.statusCode || res.statusCode === 200) res.status(403);
          return originalJson({
            success: false,
            message: 'درخواست مجاز نیست',
            code: 'WAF_BLOCKED',
          });
        }
      }
      return originalJson(body);
    };
    next();
  };
}

/**
 * قبل از کل زنجیره firewtwall: سطح اپ و نشست لاگین‌شده را trusted کن.
 * firewtwall خودش bypassPaths را اجرا نمی‌کند.
 */
function createPathBypassMiddleware(bypassPaths = []) {
  const exact = new Set(bypassPaths.filter(Boolean));
  return function wafPathBypass(req, _res, next) {
    const p = normalizeReqPath(req);
    if (
      exact.has(p)
      || isAppSurfacePath(p)
      || hasAppSessionCookie(req)
    ) {
      req.wafTrusted = true;
    }
    next();
  };
}

function createWafGateMiddleware() {
  return function wafGate(req, _res, next) {
    if (!isWafRuntimeEnabled()) {
      req.wafTrusted = true;
    }
    next();
  };
}

function createAppWaf() {
  applyFirewtwallPatches();
  startWafLogBridge(WAF_LOG_PATH);
  const stack = createWAF(WAF_OPTIONS).map((mw) => (
    mw && mw.name === 'requestSizeMiddleware'
      ? createMultipartSafeRequestSizeMiddleware(WAF_OPTIONS)
      : mw
  ));
  return [
    createSafeWafResponseMiddleware(),
    createWafGateMiddleware(),
    // مهم: bypass قبل از scrub/stack تا rhythm/ddos اصلاً اجرا نشوند
    createPathBypassMiddleware(WAF_OPTIONS.bypassPaths),
    createWafScrubMiddleware(),
    ...stack,
    createWafRestoreMiddleware(),
  ];
}

function isWafEnabled() {
  return isWafRuntimeEnabled();
}

module.exports = {
  createAppWaf,
  isWafEnabled,
  isAppSurfacePath,
  WAF_LOG_PATH,
  WAF_OPTIONS,
};
