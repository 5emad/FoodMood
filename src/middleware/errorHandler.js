const { writeSystemLog } = require('../services/SystemLogService');
const { markUnhealthy, isDatabaseError } = require('../helpers/HealthState');
const { renderUnavailable, isSuperadminSession } = require('../helpers/UnavailableHelper');
const { buildErrorLogEntry } = require('../helpers/SystemLogCatalog');

function isAdminRequest(req) {
  const url = requestPath(req);
  return url.startsWith('/admin') || url.startsWith('/api/admin');
}

function requestPath(req) {
  const raw = req.originalUrl || req.url || req.path || '';
  return String(raw).split('?')[0];
}

function wantsHtml(req) {
  return req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/');
}

function renderAdminDbError(req, res) {
  if (wantsHtml(req)) {
    return res.status(503).render('auth/login', {
      organizationName: 'سامانه تغذیه',
      publicUrl: '',
      expired: false,
      idle: false,
      inactive: false,
      error: 'اتصال به پایگاه داده برقرار نیست. روی سرور دستور update را اجرا کنید و دوباره وارد شوید.',
    });
  }
  return res.status(503).json({
    success: false,
    code: 'SERVICE_UNAVAILABLE',
    message: 'اتصال به پایگاه داده برقرار نیست',
  });
}

const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const isServerError = status >= 500;
  const logEntry = buildErrorLogEntry(req, err, status);

  writeSystemLog(logEntry.level, logEntry.category, logEntry.message, logEntry.meta);

  if (isDatabaseError(err)) {
    markUnhealthy('database', err.message);
  }

  const isApiRequest = req.originalUrl.startsWith('/api/');

  if (isServerError && isAdminRequest(req) && isDatabaseError(err)) {
    return renderAdminDbError(req, res);
  }

  if (isServerError && !isSuperadminSession(req)) {
    if (!isApiRequest) {
      return renderUnavailable(req, res, 503);
    }
    if (isDatabaseError(err)) {
      return res.status(503).json({
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'در حال حاضر سامانه تغذیه در دسترس نمی‌باشد',
      });
    }
  }

  const safeMessage = (err.status && status < 500)
    ? err.message
    : (err.expose
      ? err.message
      : (process.env.NODE_ENV === 'production' && isServerError
        ? 'در حال حاضر سامانه تغذیه در دسترس نمی‌باشد'
        : (err.message || 'خطای داخلی سرور')));

  if (wantsHtml(req)) {
    if (isServerError) return renderUnavailable(req, res, 503);
    return res.status(status).render('index', {
      user: req.user || null,
      error: safeMessage,
    });
  }

  res.status(isServerError ? 503 : status).json({
    success: false,
    code: isServerError
      ? (isDatabaseError(err) ? 'SERVICE_UNAVAILABLE' : 'SERVER_ERROR')
      : 'REQUEST_ERROR',
    message: safeMessage,
    ...(process.env.NODE_ENV !== 'production' && isServerError && safeMessage !== err.message && { detail: err.message }),
  });
};

module.exports = errorHandler;
