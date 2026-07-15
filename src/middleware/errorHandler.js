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

function isAuthApiRequest(req) {
  const url = requestPath(req);
  return url.startsWith('/api/auth');
}

function isConflictError(err) {
  return Number(err?.code) === 40
    || /would create a conflict/i.test(String(err?.message || ''));
}

const errorHandler = (err, req, res, next) => {
  let status = err.status || 500;
  if (isConflictError(err) && status >= 500) status = 409;

  const isServerError = status >= 500;
  const dbOutage = isDatabaseError(err);
  const logEntry = buildErrorLogEntry(req, err, status);

  writeSystemLog(logEntry.level, logEntry.category, logEntry.message, logEntry.meta);

  if (dbOutage) {
    markUnhealthy('database', err.message);
  }

  const isApiRequest = req.originalUrl.startsWith('/api/');

  if (isServerError && isAdminRequest(req) && dbOutage) {
    return renderAdminDbError(req, res);
  }

  if (isServerError && !isSuperadminSession(req) && !isAuthApiRequest(req)) {
    if (!isApiRequest) {
      return renderUnavailable(req, res, 503);
    }
    if (dbOutage) {
      return res.status(503).json({
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'در حال حاضر سامانه تغذیه در دسترس نمی‌باشد',
      });
    }
  }

  let safeMessage;
  if (err.status && status < 500) {
    safeMessage = err.message;
  } else if (err.expose) {
    safeMessage = err.message;
  } else if (isConflictError(err)) {
    safeMessage = 'ذخیره تنظیمات با تداخل انجام شد؛ لطفاً دوباره تلاش کنید';
  } else if (dbOutage) {
    safeMessage = 'در حال حاضر سامانه تغذیه در دسترس نمی‌باشد';
  } else if (isServerError) {
    // Keep API errors actionable — do not masquerade every 500 as a portal outage.
    safeMessage = isApiRequest
      ? (err.message || 'خطای داخلی سرور')
      : 'در حال حاضر سامانه تغذیه در دسترس نمی‌باشد';
  } else {
    safeMessage = err.message || 'خطای داخلی سرور';
  }

  if (wantsHtml(req)) {
    if (isServerError && dbOutage) return renderUnavailable(req, res, 503);
    if (isServerError) return renderUnavailable(req, res, 503);
    return res.status(status).render('index', {
      user: req.user || null,
      error: safeMessage,
    });
  }

  res.status(isServerError ? 503 : status).json({
    success: false,
    code: isServerError
      ? (dbOutage ? 'SERVICE_UNAVAILABLE' : 'SERVER_ERROR')
      : (isConflictError(err) ? 'CONFLICT' : 'REQUEST_ERROR'),
    message: safeMessage,
    ...(process.env.NODE_ENV !== 'production' && isServerError && safeMessage !== err.message && { detail: err.message }),
  });
};

module.exports = errorHandler;
