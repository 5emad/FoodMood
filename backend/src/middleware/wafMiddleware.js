const path = require('path');
const { createWAF } = require('firewtwall');
const { startWafLogBridge } = require('../services/WafLogBridge');
const {
  applyFirewtwallPatches,
  createWafScrubMiddleware,
  createWafRestoreMiddleware,
} = require('./firewtwallPatches');

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

/**
 * کانفیگ استاندارد firewtwall برای FoodMood
 *
 * بر اساس بردارهای اخیر پروژه:
 * - جعل X-Forwarded-For برای دور زدن rate-limit
 * - SQLi / XSS / Path Traversal در query
 * - NoSQL / LDAP injection
 * - flood و fuzz اسکنر (mutation / burst)
 * - آپلود تا ۵MB (غذا / اسلایدر)
 *
 * نکته: در firewtwall شمارندهٔ global عملاً روی پنجرهٔ ۶۰ثانیه کار می‌کند
 * (حتی اگر windowMs=1000 باشد) — سقف را بر همان اساس می‌گذاریم.
 */
const apiRateDefault = envInt('API_RATE_LIMIT_MAX', 400);

const WAF_OPTIONS = {
  mode: 'reject',
  responseType: 'json',
  logPath: WAF_LOG_PATH,
  debug: process.env.WAF_DEBUG === 'true',

  // JSON اپ ۱MB است؛ آپلود تصویر تا ۵MB + سربار multipart
  maxBodySize: envInt('WAF_MAX_BODY_BYTES', 6 * 1024 * 1024),

  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],

  whitelist: envList('WAF_WHITELIST'),
  blacklist: envList('WAF_BLACKLIST'),

  // پیش‌فرض خالی = IP سوکت واقعی (ضد جعل XFF).
  // در داکر پشت nginx: TRUSTED_PROXIES / WAF_TRUSTED_PROXIES = شبکه داخلی
  trustedProxies: envList('WAF_TRUSTED_PROXIES').length
    ? envList('WAF_TRUSTED_PROXIES')
    : envList('TRUSTED_PROXIES'),

  bypassPaths: [
    '/api/system/health',
    '/api/auth/csrf',
    '/favicon.ico',
  ],

  // لایهٔ سخت بیرونی؛ limiter اپ همچنان برای لاگین/API جزئی‌تر عمل می‌کند
  rateLimit: {
    windowMs: 60 * 1000,
    maxRequests: envInt('WAF_RATE_LIMIT_MAX', Math.max(apiRateDefault, 400)),
    blockDurationMs: envInt('WAF_BLOCK_MS', 10 * 60 * 1000),
  },

  ddos: {
    maxUrlLength: 2048,
    maxHeaderCount: 64,
    maxHeaderSize: 4096,
    burst: {
      windowMs: 1000,
      maxRequests: envInt('WAF_BURST_MAX', 30),
      blockDurationMs: 2 * 60 * 1000,
    },
    // عملاً per-minute در این نسخهٔ کتابخانه
    global: {
      windowMs: 60_000,
      maxRequests: envInt('WAF_GLOBAL_MAX', 20_000),
    },
    fingerprint: {
      windowMs: 10_000,
      maxRequests: envInt('WAF_FP_MAX', 100),
      blockDurationMs: 2 * 60 * 1000,
    },
    pathFlood: {
      windowMs: 5_000,
      maxRequests: envInt('WAF_PATH_FLOOD_MAX', 400),
    },
    tarpit: {
      enabled: process.env.WAF_TARPIT !== 'false',
      delayMs: envInt('WAF_TARPIT_MS', 1200),
    },
  },

  // payload مبهم / double-encode / shellcode
  entropy: {
    minLength: 24,
    shellcodeThreshold: 6.5,
    encodedThreshold: 5.6,
    b64Threshold: 6.0,
  },

  // encoding-mix روی کوکی/توکن حساس است؛ آستانه بالا + پچ skip کوکی sid
  heuristic: {
    encodingMixThreshold: 6,
    nestingDepthThreshold: 6,
    keywordDensityThreshold: 3,
    operatorStormThreshold: 15,
  },

  // فازیگ و replay اسکنر (مثل راند حملهٔ جعبه‌سیاه)
  mutation: {
    windowMs: 60_000,
    maxVariants: 4,
    levenshteinThreshold: 8,
    replayThreshold: 8,
  },

  // الگوی زمانی بات/اسکنر — نه کاربر معمولی UI
  rhythm: {
    sampleSize: 12,
    machineStddevThreshold: 40,
    burstWindowMs: 150,
    lowSlowJitterMs: 8,
  },
};

/**
 * پاسخ بلاک WAF را برای کلاینت عمومی می‌کند — بدون rule / blocked / پیام انگلیسی فنی.
 * جزئیات فقط در waf.log و SecurityLog می‌ماند.
 */
function createSafeWafResponseMiddleware() {
  return function safeWafResponse(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = function sanitizeWafJson(body) {
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const isWafBlock = body.blocked === true
          || (typeof body.rule === 'string' && /waf|blocked by waf/i.test(String(body.message || '')))
          || /Request blocked by WAF/i.test(String(body.message || ''));
        if (isWafBlock) {
          if (!res.statusCode || res.statusCode === 200) res.status(403);
          return originalJson({
            success: false,
            message: 'درخواست مجاز نیست',
          });
        }
      }
      return originalJson(body);
    };
    next();
  };
}

/**
 * firewtwall فیلد bypassPaths را اجرا نمی‌کند — قبل از زنجیره علامت trusted می‌زنیم.
 * exact + چند پیشوند امن (استاتیک/هلث).
 */
function createPathBypassMiddleware(bypassPaths = []) {
  const exact = new Set(bypassPaths.filter(Boolean));
  const prefixes = ['/vendor/', '/css/', '/js/', '/spa/assets/'];
  return function wafPathBypass(req, _res, next) {
    const p = req.path || '';
    if (exact.has(p) || prefixes.some((pre) => p.startsWith(pre))) {
      req.wafTrusted = true;
    }
    next();
  };
}

function createAppWaf() {
  applyFirewtwallPatches();
  startWafLogBridge(WAF_LOG_PATH);
  const stack = createWAF(WAF_OPTIONS);
  return [
    createSafeWafResponseMiddleware(),
    createWafScrubMiddleware(),
    createPathBypassMiddleware(WAF_OPTIONS.bypassPaths),
    ...stack,
    // مهم: بعد از WAF و قبل از روت‌ها — وگرنه weekId/id از query/body گم می‌ماند
    createWafRestoreMiddleware(),
  ];
}

module.exports = {
  createAppWaf,
  WAF_LOG_PATH,
  WAF_OPTIONS,
};
