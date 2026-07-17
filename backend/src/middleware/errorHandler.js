const { writeSystemLog } = require('../services/SystemLogService');
const { markUnhealthy, isDatabaseError } = require('../helpers/HealthState');
const { renderUnavailable, isSuperadminSession } = require('../helpers/UnavailableHelper');
const { buildErrorLogEntry } = require('../helpers/SystemLogCatalog');
const { looksTechnicalErrorMessage } = require('../helpers/ClientErrorHelper');

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
  if (err.name === 'CastError' || err.kind === 'ObjectId') {
    status = 400;
    err.status = 400;
    err.expose = true;
    err.message = 'شناسه نامعتبر است';
  }
  if (err instanceof SyntaxError || err.type === 'entity.parse.failed' || /JSON|Unexpected token|Expected property/i.test(String(err.message || ''))) {
    status = 400;
    err.status = 400;
    err.expose = true;
    err.message = 'درخواست نامعتبر است';
  }
  if (Number(err?.code) === 11000) {
    status = 409;
    err.status = 409;
    err.expose = true;
    if (!err.message || looksTechnicalErrorMessage(err.message)) {
      err.message = 'رکورد تکراری است';
    }
  }
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

  // Client-safe message policy:
  // - status < 500 + deliberate app error: expose message
  // - status >= 500: fixed message (or deliberate non-technical expose)
  // - NEVER return raw driver/path/stderr details
  let safeMessage;
  if (status < 500 && (err.status || err.expose)) {
    safeMessage = looksTechnicalErrorMessage(err.message)
      ? 'درخواست نامعتبر است'
      : err.message;
  } else if (isConflictError(err)) {
    safeMessage = 'ذخیره تنظیمات با تداخل انجام شد؛ لطفاً دوباره تلاش کنید';
  } else if (dbOutage) {
    safeMessage = 'در حال حاضر سامانه تغذیه در دسترس نمی‌باشد';
  } else if (isServerError) {
    safeMessage = (err.expose && err.message && !looksTechnicalErrorMessage(err.message))
      ? err.message
      : 'خطای داخلی سرور؛ لطفاً بعداً دوباره تلاش کنید';
  } else {
    safeMessage = 'درخواست نامعتبر است';
  }

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
      ? (dbOutage ? 'SERVICE_UNAVAILABLE' : 'SERVER_ERROR')
      : (isConflictError(err) ? 'CONFLICT' : 'REQUEST_ERROR'),
    message: safeMessage,
  });
};

module.exports = errorHandler;
