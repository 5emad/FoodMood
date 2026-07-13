const { writeSystemLog } = require('../services/SystemLogService');
const { markUnhealthy, isDatabaseError } = require('../helpers/HealthState');
const { renderUnavailable, isSuperadminSession } = require('../helpers/UnavailableHelper');
const { buildErrorLogEntry } = require('../helpers/SystemLogCatalog');

const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const isServerError = status >= 500;
  const logEntry = buildErrorLogEntry(req, err, status);

  writeSystemLog(logEntry.level, logEntry.category, logEntry.message, logEntry.meta);

  if (isDatabaseError(err)) {
    markUnhealthy('database', err.message);
  }

  if (isServerError && !isSuperadminSession(req)) {
    return renderUnavailable(req, res, 503);
  }

  const safeMessage = (err.status && status < 500)
    ? err.message
    : (process.env.NODE_ENV === 'production' ? 'در حال حاضر سامانه تغذیه در دسترس نمی‌باشد' : (err.message || 'خطای داخلی سرور'));

  if (req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/')) {
    if (isServerError) return renderUnavailable(req, res, 503);
    return res.status(status).render('index', {
      user: req.user || null,
      error: safeMessage,
    });
  }

  res.status(isServerError ? 503 : status).json({
    success: false,
    code: isServerError ? 'SERVICE_UNAVAILABLE' : 'REQUEST_ERROR',
    message: isServerError ? 'در حال حاضر سامانه تغذیه در دسترس نمی‌باشد' : safeMessage,
    ...(process.env.NODE_ENV !== 'production' && isServerError && { detail: err.message }),
  });
};

module.exports = errorHandler;
