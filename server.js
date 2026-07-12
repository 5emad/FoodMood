require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const helmet     = require('helmet');
const cors       = require('cors');
const mongoSanitize = require('./src/middleware/mongoSanitize');
const originGuard = require('./src/middleware/originGuard');
const { ensureCsrfToken, csrfMiddleware } = require('./src/middleware/csrfMiddleware');
const path       = require('path');

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
const userRoutes      = require('./src/routes/userRoutes');
const adminViewRoutes = require('./src/routes/adminViewRoutes');
const ThemeController = require('./src/controllers/ThemeController');
const MongoSessionStore = require('./src/config/MongoSessionStore');
const { getMaxMs } = require('./src/helpers/SessionSecurityHelper');

const app  = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (process.env.NODE_ENV === 'production') {
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
  frameguard:   { action: 'deny' },
  hsts:         { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff:      true,
  xssFilter:    true,
  referrerPolicy: { policy: 'same-origin' },
}));

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
app.use(session({
  secret:            SESSION_SECRET || 'development-only-session-secret-change-me',
  resave:            false,
  saveUninitialized: false,
  rolling:           true,
  store:             new MongoSessionStore({ ttlMs: sessionMaxAgeMs }),
  name:              process.env.NODE_ENV === 'production' ? '__Host-sid' : 'sid',
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge:   sessionMaxAgeMs,
  },
}));

// ── View engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth/login',  loginLimiter);
app.use('/api',             apiLimiter);
app.get('/api/auth/csrf', (req, res) => {
  res.json({ success: true, csrfToken: ensureCsrfToken(req) });
});
app.use('/api', csrfMiddleware);

app.use('/api/auth',   authRoutes);
app.use('/api/foods',  foodRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin',  adminRoutes);
app.use('/api/menu',   menuRoutes);

// ── View routes (add no-cache to all rendered pages) ─────────────────────────
app.use('/',       noCache, viewRoutes);
app.use('/user',   noCache, userRoutes);
app.use('/admin',  noCache, adminViewRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/')) {
    return res.status(404).render('index', { user: req.user || null, error: 'مسیر یافت نشد' });
  }
  res.status(404).json({ message: 'مسیر یافت نشد' });
});

app.use(errorHandler);

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  await connectDB();

  const { ensureCurrentWeek }                       = require('./src/controllers/AdminController');
  const { finalizeExpiredOrders, ensureOrderNumbers } = require('./src/helpers/OrderStatusHelper');

  await ensureCurrentWeek();
  await ensureOrderNumbers();
  await finalizeExpiredOrders();

  setInterval(() => {
    finalizeExpiredOrders().catch((err) => console.error('Order finalize error:', err.message));
  }, 60 * 1000);

  app.listen(PORT, () => {
    console.log(`سرور در حال اجرا است: http://localhost:${PORT}`);
  });
}

async function shutdown(signal) {
  console.log(`${signal} received; closing MongoDB connection.`);
  await require('mongoose').connection.close();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

bootstrap().catch((err) => {
  console.error('خطا در راه‌اندازی سرور:', err);
  process.exit(1);
});
