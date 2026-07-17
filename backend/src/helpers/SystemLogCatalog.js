/**
 * پیام‌های استاندارد و حرفه‌ای لاگ سیستمی (فارسی)
 */
const EVENT_LABELS = {
  server_start: 'راه‌اندازی سرویس',
  server_stop: 'توقف سرویس',
  db_connect: 'اتصال پایگاه داده',
  db_disconnect: 'قطع پایگاه داده',
  db_reconnect_attempt: 'تلاش اتصال مجدد',
  service_unavailable: 'قطعی سامانه',
  service_restored: 'بازیابی سامانه',
  http_error: 'خطای درخواست',
  app_error: 'خطای برنامه',
  unhandled_rejection: 'خطای ناهمگام',
  uncaught_exception: 'خطای بحرانی',
  order_job_error: 'خطای سفارش',
  port_conflict: 'تعارض پورت',
  bootstrap_error: 'خطای راه‌اندازی',
  db_test_outage: 'تست قطعی',
};

const CATEGORY_LABELS = {
  database: 'پایگاه داده',
  server: 'سرویس',
  orders: 'سفارش‌ها',
  auth: 'احراز هویت',
  lifecycle: 'چرخه عمر',
  api: 'رابط برنامه',
};

function msgServerStart(port) {
  return `سرویس FoodMood با موفقیت راه‌اندازی شد (پورت ${port})`;
}

function msgServerStop(signal) {
  return `سرویس FoodMood متوقف شد (سیگنال: ${signal})`;
}

function msgDbConnected() {
  return 'اتصال به پایگاه داده MongoDB برقرار گردید';
}

function msgDbReconnected() {
  return 'اتصال به پایگاه داده MongoDB پس از قطعی، بازیابی شد';
}

function msgDbDisconnected() {
  return 'ارتباط با پایگاه داده MongoDB قطع شد';
}

function msgDbError(detail) {
  return `خطا در ارتباط با پایگاه داده MongoDB: ${detail}`;
}

function msgDbConnectFailed(detail) {
  return `اتصال اولیه به پایگاه داده MongoDB ناموفق بود: ${detail}`;
}

function msgDbReconnectAttempt() {
  return 'تلاش مجدد برای برقراری اتصال به پایگاه داده MongoDB';
}

function msgDbReconnectFailed(detail) {
  return `تلاش مجدد اتصال به پایگاه داده ناموفق بود: ${detail}`;
}

function msgServiceUnavailable(detail) {
  return detail
    ? `سامانه به‌دلیل بروز مشکل فنی موقتاً در دسترس نیست (${detail})`
    : 'سامانه به‌دلیل بروز مشکل فنی موقتاً در دسترس نیست';
}

function msgServiceRestored() {
  return 'سامانه مجدداً در وضعیت عملیاتی قرار گرفت';
}

function msgPortConflict(port) {
  return `پورت ${port} در حال استفاده است؛ سرویس قادر به راه‌اندازی نیست`;
}

function msgBootstrapError(detail) {
  return `خطای بحرانی در فرآیند راه‌اندازی سامانه: ${detail}`;
}

function msgOrderJobError(detail) {
  return `خطا در پردازش خودکار وضعیت سفارش‌ها: ${detail}`;
}

function msgUnhandledRejection(detail) {
  return `خطای پیش‌بینی‌نشده در اجرای سامانه: ${detail}`;
}

function msgUncaughtException(detail) {
  return `خطای بحرانی و مدیریت‌نشده در سرویس: ${detail}`;
}

function msgHttpError(method, url, status, detail) {
  const path = url || '/';
  const verb = method || 'GET';
  if (status >= 500) {
    return `خطای داخلی سرور هنگام پردازش ${verb} ${path}`;
  }
  return `درخواست نامعتبر یا خطای سطح کاربر: ${verb} ${path} (کد ${status})${detail ? ` — ${detail}` : ''}`;
}

function msgDbTestOutage(seconds) {
  return `اجرای تست قطعی پایگاه داده به مدت ${seconds} ثانیه`;
}

function msgDbShutdownClose() {
  return 'اتصال پایگاه داده هنگام خاموش‌سازی سرویس بسته شد';
}

function msgDbShutdownCloseFailed(detail) {
  return `بستن اتصال پایگاه داده هنگام خاموش‌سازی با خطا مواجه شد: ${detail}`;
}

function msgDbTestRecoveryFailed(detail) {
  return `بازیابی پایگاه داده پس از تست قطعی ناموفق بود: ${detail}`;
}

function buildErrorLogEntry(req, err, status) {
  const isDb = isDatabaseError(err);
  const isServerError = status >= 500;
  const method = req?.method || '';
  const url = req?.originalUrl || req?.url || '';
  const technical = err?.message || 'خطای ناشناخته';

  return {
    level: isServerError ? 'error' : 'warn',
    category: isDb ? 'database' : (url.startsWith('/api') ? 'api' : 'server'),
    message: msgHttpError(method, url, status, isServerError ? '' : technical),
    meta: {
      event: 'http_error',
      code: err?.code || `HTTP_${status}`,
      detail: technical,
      stack: err?.stack || '',
      url,
      method,
    },
  };
}

function isDatabaseError(err) {
  if (!err) return false;
  const name = String(err.name || '');
  const message = String(err.message || '').toLowerCase();
  const code = Number(err.code);

  // Application-level Mongo write errors — not an outage.
  if (code === 40 || code === 11000 || code === 121) return false;
  if (message.includes('would create a conflict')) return false;

  if (
    name === 'MongoNetworkError'
    || name === 'MongoServerSelectionError'
    || name === 'MongoTimeoutError'
    || name === 'MongoParseError'
    || name === 'MongoNotConnectedError'
    || name === 'PoolClearedOnNetworkError'
    || name === 'MongoPoolClearedError'
  ) {
    return true;
  }

  return message.includes('buffering timed out')
    || message.includes('econnrefused')
    || message.includes('server selection')
    || message.includes('topology was destroyed')
    || message.includes('connection refused')
    || message.includes('interrupted due to server monitor')
    || (name === 'MongooseError' && message.includes('buffering'));
}

module.exports = {
  EVENT_LABELS,
  CATEGORY_LABELS,
  msgServerStart,
  msgServerStop,
  msgDbConnected,
  msgDbReconnected,
  msgDbDisconnected,
  msgDbError,
  msgDbConnectFailed,
  msgDbReconnectAttempt,
  msgDbReconnectFailed,
  msgServiceUnavailable,
  msgServiceRestored,
  msgPortConflict,
  msgBootstrapError,
  msgOrderJobError,
  msgUnhandledRejection,
  msgUncaughtException,
  msgHttpError,
  msgDbTestOutage,
  msgDbShutdownClose,
  msgDbShutdownCloseFailed,
  msgDbTestRecoveryFailed,
  buildErrorLogEntry,
  isDatabaseError,
};
