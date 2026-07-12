const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  const status = err.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  // Only expose messages that were set intentionally (via err.status).
  // Unexpected 5xx errors must not leak internal details in production.
  const safeMessage = (err.status && status < 500)
    ? err.message
    : (isProduction ? 'خطای داخلی سرور' : (err.message || 'خطای داخلی سرور'));

  if (req.accepts(['html', 'json']) === 'html' && !req.originalUrl.startsWith('/api/')) {
    return res.status(status).render('index', {
      user: req.user || null,
      error: safeMessage,
    });
  }

  res.status(status).json({
    success: false,
    message: safeMessage,
    ...(!isProduction && status >= 500 && { error: err.message }),
  });
};

module.exports = errorHandler;
