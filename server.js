require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const helmet     = require('helmet');
const cors       = require('cors');
const mongoSanitize = require('./src/middleware/mongoSanitize');
const originGuard = require('./src/middleware/originGuard');
const { ensureCsrfToken, csrfMiddleware } = require('./src/middleware/csrfMiddleware');
const path       = require('path');
const ejs        = require('ejs');

const connectDB      = require('./src/config/database');
const errorHandler   = require('./src/middleware/errorHandler');
const noCache        = require('./src/middleware/noCache');
const { loginLimiter, apiLimiter } = require('./src/middleware/rateLimiter');

const authRoutes      = require('./src/routes/authRoutes');
const foodRoutes      = require('./src/routes/foodRoutes');
const orderRoutes     = require('./src/routes/orderRoutes');
const adminRoutes     = require('./src/routes/adminRoutes');
const menuRoutes      = require('./src/routes/menuRoutes');
const viewRoutes      = require('./src/routes/viewRoutes');
const userRoutes           = require('./src/routes/userRoutes');
const announcementRoutes   = require('./src/routes/announcementRoutes');
const adminViewRoutes = require('./src/routes/adminViewRoutes');
const ThemeController = require('./src/controllers/ThemeController');
const MongoSessionStore = require('./src/config/MongoSessionStore');
const { getMaxMs } = require('./src/helpers/SessionSecurityHelper');
const { getVersionViewModel, versionMiddleware } = require('./src/helpers/AppVersionHelper');
const { ensureLogDir, writeSystemLog, recordLifecycleEvent, readLifecycleStats } = require('./src/services/SystemLogService');
const {
  msgServerStart,
  msgServerStop,
  msgDbConnectFailed,
  msgDbReconnectAttempt,
  msgDbReconnectFailed,
  msgPortConflict,
  msgBootstrapError,
  msgOrderJobError,
  msgDbTestOutage,
  msgDbTestRecoveryFailed,
  msgDbShutdownClose,
  msgDbShutdownCloseFailed,
  msgUnhandledRejection,
  msgUncaughtException,
  msgHttpError,
} = require('./src/helpers/SystemLogCatalog');
const { markUnhealthy } = require('./src/helpers/HealthState');
const { appUrlMiddleware, canonicalHostMiddleware } = require('./src/middleware/appUrlMiddleware');
const healthGateMiddleware = require('./src/middleware/healthGateMiddleware');

const app  = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const trustTls = process.env.TRUST_TLS === 'true'
  || /^https:\/\//i.test(process.env.APP_URL || '');
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookieName = isProduction && trustTls ? '__Host-sid' : 'sid';

if (isProduction) {
  if (!SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production');
  if (!process.env.BACKUP_SECRET) throw new Error('BACKUP_SECRET is required in production');
  if (!process.env.PASSWORD_PEPPER) {
    console.warn('WARNING: PASSWORD_PEPPER is not set; password hashes rely on bcrypt only.');
  }
}

app.disable('x-powered-by');

// ── Trust proxy (needed for accurate IP rate limiting) ───────────────────────
app.set('trust proxy', 1);

const publicDir = path.join(__dirname, 'public');
const staticCache = isProduction ? '7d' : 0;
const staticHeaders = (res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

// Static assets first — never blocked by session/health middleware
app.use('/vendor', express.static(path.join(publicDir, 'vendor'), {
  maxAge: staticCache,
  setHeaders: staticHeaders,
}));
app.use('/css', express.static(path.join(publicDir, 'css'), {
  maxAge: staticCache,
  setHeaders: staticHeaders,
}));
app.use('/js', express.static(path.join(publicDir, 'js'), {
  maxAge: staticCache,
  setHeaders: staticHeaders,
}));
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ── Security headers via Helmet ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'"],
      scriptSrcAttr:  ["'unsafe-inline'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", 'data:', 'blob:'],
      fontSrc:        ["'self'"],
      connectSrc:     ["'self'"],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: trustTls ? { policy: 'same-origin' } : false,
  crossOriginResourcePolicy: trustTls ? { policy: 'same-origin' } : false,
  frameguard:   { action: 'deny' },
  hsts:         trustTls ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  noSniff:      true,
  xssFilter:    true,
  referrerPolicy: { policy: 'same-origin' },
}));

// Plain-HTTP installs: clear any browser HSTS cache and drop HTTPS-only headers.
if (!trustTls) {
  app.use((_req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=0');
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.removeHeader('Cross-Origin-Resource-Policy');
    res.removeHeader('Origin-Agent-Cluster');
    next();
  });
}

// ── CORS: only allow same origin in production ───────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : [];
if (process.env.APP_URL) allowedOrigins.push(process.env.APP_URL);
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    `http://[::1]:${PORT}`,
  );
}

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / server-side
    if (allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error('CORS policy violation'));
  },
  credentials: true,
}));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(originGuard);

app.get('/css/theme-vars.css', ThemeController.variables);

// ── MongoDB operator injection prevention ────────────────────────────────────
app.use(mongoSanitize);

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

// ── Session ───────────────────────────────────────────────────────────────────
const sessionMaxAgeMs = getMaxMs();
// Dev fallback: random per boot instead of a hardcoded guessable secret
app.use(session({
  secret:            SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave:            false,
  saveUninitialized: false,
  rolling:           true,
  store:             new MongoSessionStore({ ttlMs: sessionMaxAgeMs }),
  name:              sessionCookieName,
  cookie: {
    secure:   isProduction && trustTls,
    httpOnly: true,
    sameSite: 'strict',
    maxAge:   sessionMaxAgeMs,
  },
}));

app.use(appUrlMiddleware);
app.use(canonicalHostMiddleware);

// ── View engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.engine('ejs', (filePath, options, callback) => {
  ejs.renderFile(filePath, { ...getVersionViewModel(), ...(options || {}) }, callback);
});
app.use(versionMiddleware);
app.use(healthGateMiddleware);

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth/login',  loginLimiter);
app.use('/api',             apiLimiter);
app.get('/api/system/health', (req, res) => {
  const { getHealthStatus } = require('./src/helpers/HealthState');
  const health = getHealthStatus();
  // Lifecycle counters are internal detail — only exposed in test mode.
  // Superadmins see them via the authenticated /api/admin security endpoint.
  const data = process.env.ALLOW_SYSTEM_TEST === 'true'
    ? { ...health, lifecycle: readLifecycleStats() }
    : health;
  res.status(health.healthy ? 200 : 503).json({
    success: health.healthy,
    data,
  });
});

if (process.env.ALLOW_SYSTEM_TEST === 'true') {
  const authMiddleware = require('./src/middleware/authMiddleware');
  const roleMiddleware = require('./src/middleware/roleMiddleware');
  app.post('/api/system/test-disconnect-db', authMiddleware, roleMiddleware(['superadmin']), async (req, res) => {
    const mongoose = require('mongoose');
    const seconds = Math.min(Math.max(Number(req.body?.seconds) || 30, 5), 120);
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
      }
      recordLifecycleEvent('db_disconnect', msgDbTestOutage(seconds), {
        level: 'warn',
        category: 'database',
        code: 'DB_TEST_OUTAGE',
        detail: 'ALLOW_SYSTEM_TEST',
      });
      setTimeout(async () => {
        try {
          await connectDB();
          await runPostConnectTasks();
        } catch (err) {
          writeSystemLog('warn', 'database', msgDbTestRecoveryFailed(err.message), {
            event: 'db_test_recovery_failed',
            code: 'DB_TEST_RECOVERY_FAIL',
            detail: err.message,
          });
          scheduleDbReconnect();
        }
      }, seconds * 1000);
      res.json({
        success: true,
        message: `دیتابیس برای ${seconds} ثانیه قطع شد. صفحه «در دسترس نیست» را در مرورگر بررسی کنید.`,
        seconds,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });
}

app.get('/api/auth/csrf', (req, res) => {
  res.json({ success: true, csrfToken: ensureCsrfToken(req) });
});
app.use('/api', csrfMiddleware);

app.use('/api/auth',   authRoutes);
app.use('/api/foods',  foodRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin',  adminRoutes);
app.use('/api/menu',          menuRoutes);
app.use('/api/announcements', announcementRoutes);

// ── View routes (add no-cache to all rendered pages) ─────────────────────────
app.use('/',       noCache, viewRoutes);
app.use('/user',   noCache, userRoutes);
app.use('/admin',  noCache, adminViewRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.originalUrl.startsWith('/api/')) {
    writeSystemLog('warn', 'api', msgHttpError(req.method, req.originalUrl, 404, 'مسیر درخواستی یافت نشد'), {
      event: 'http_error',
      code: 'NOT_FOUND',
      url: req.originalUrl,
      method: req.method,
    });
    return res.status(404).json({ message: 'مسیر یافت نشد' });
  }
  if (req.accepts(['html', 'json']) === 'html') {
    return res.status(404).render('index', { user: req.user || null, error: 'مسیر یافت نشد' });
  }
  res.status(404).json({ message: 'مسیر یافت نشد' });
});

app.use(errorHandler);

// ── Bootstrap ─────────────────────────────────────────────────────────────────
ensureLogDir();

let reconnectTimer = null;
let postConnectDone = false;

async function runPostConnectTasks() {
  if (postConnectDone) return;
  postConnectDone = true;
  const { ensureCurrentWeek }                       = require('./src/controllers/AdminController');
  const { finalizeExpiredOrders, ensureOrderNumbers } = require('./src/helpers/OrderStatusHelper');
  const AppSetting = require('./src/models/AppSetting');
  const { normalizePublicUrl, refreshPublicUrlCache, prefersHttps } = require('./src/helpers/AppUrlHelper');
  const { refreshOriginPublicUrlCache } = require('./src/middleware/originGuard');

  if (process.env.APP_URL) {
    const settings = await AppSetting.findOne({ key: 'default' }).lean();
    const publicUrl = normalizePublicUrl(process.env.APP_URL);
    if (publicUrl) {
      const stored = normalizePublicUrl(settings?.publicUrl || '');
      const shouldSync = !stored || (!prefersHttps() && stored !== publicUrl);
      if (shouldSync) {
        await AppSetting.updateOne({ key: 'default' }, { $set: { publicUrl } }, { upsert: true });
        refreshPublicUrlCache(publicUrl);
        await refreshOriginPublicUrlCache();
      }
    }
  }

  await ensureCurrentWeek();
  await ensureOrderNumbers();
  await finalizeExpiredOrders();

  setInterval(() => {
    finalizeExpiredOrders().catch((err) => {
      writeSystemLog('error', 'orders', msgOrderJobError(err.message), {
        event: 'order_job_error',
        stack: err.stack,
        detail: err.message,
      });
    });
  }, 60 * 1000);
}

function scheduleDbReconnect() {
  if (reconnectTimer) return;
  const mongoose = require('mongoose');
  reconnectTimer = setInterval(async () => {
    if (mongoose.connection.readyState === 1) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      return;
    }
    try {
      recordLifecycleEvent('db_reconnect_attempt', msgDbReconnectAttempt(), {
        level: 'warn',
        category: 'database',
        code: 'DB_RECONNECT_TRY',
      });
      await connectDB();
      await runPostConnectTasks();
    } catch (err) {
      writeSystemLog('warn', 'database', msgDbReconnectFailed(err.message), {
        event: 'db_reconnect_attempt',
        code: 'DB_RECONNECT_FAIL',
        detail: err.message,
      });
    }
  }, 15000);
}

async function bootstrap() {
  try {
    await connectDB();
    await runPostConnectTasks();
  } catch (err) {
    markUnhealthy('database', err.message);
    recordLifecycleEvent('db_disconnect', msgDbConnectFailed(err.message), {
      level: 'error',
      category: 'database',
      code: 'DB_CONNECT_FAIL',
      stack: err.stack,
      detail: err.message,
    });
    scheduleDbReconnect();
  }

  app.listen(PORT, () => {
    console.log(`سرور در حال اجرا است: http://localhost:${PORT}`);
    recordLifecycleEvent('server_start', msgServerStart(PORT), {
      level: 'info',
      category: 'server',
      code: 'SERVER_START',
      detail: `pid=${process.pid}`,
    });
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`پورت ${PORT} در حال استفاده است. ابتدا پروسه قبلی را متوقف کنید:`);
      console.error(`  Windows: netstat -ano | findstr :${PORT}  سپس  taskkill /PID <pid> /F`);
      writeSystemLog('error', 'server', msgPortConflict(PORT), { event: 'port_conflict', code: 'EADDRINUSE' });
      process.exit(1);
    }
    throw err;
  });
}

async function shutdown(signal) {
  recordLifecycleEvent('server_stop', msgServerStop(signal), {
    level: 'warn',
    category: 'server',
    code: 'SERVER_STOP',
    detail: `pid=${process.pid}`,
  });
  console.log(`${signal} received; closing MongoDB connection.`);
  try {
    await require('mongoose').connection.close();
    recordLifecycleEvent('db_disconnect', msgDbShutdownClose(), {
      level: 'info',
      category: 'database',
      code: 'DB_CLOSED_ON_SHUTDOWN',
    });
  } catch (err) {
    writeSystemLog('warn', 'database', msgDbShutdownCloseFailed(err.message), {
      event: 'db_disconnect',
      detail: err.message,
    });
  }
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  const detail = reason?.message || String(reason);
  writeSystemLog('error', 'server', msgUnhandledRejection(detail), {
    event: 'unhandled_rejection',
    stack: reason?.stack || '',
    detail,
  });
});

process.on('uncaughtException', (err) => {
  writeSystemLog('error', 'server', msgUncaughtException(err.message), {
    event: 'uncaught_exception',
    stack: err.stack,
    detail: err.message,
  });
});

bootstrap().catch((err) => {
  writeSystemLog('error', 'server', msgBootstrapError(err.message), {
    event: 'bootstrap_error',
    stack: err.stack,
    detail: err.message,
  });
  console.error('خطا در راه‌اندازی سرور:', err);
  process.exit(1);
});
