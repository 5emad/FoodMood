/**
 * Decide whether an error is safe to send to API clients as-is.
 * Server errors (status >= 500) must go through the global errorHandler.
 */
function isClientError(error) {
  const status = Number(error?.status) || 0;
  return status > 0 && status < 500;
}

function clientErrorPayload(error, { successField = true } = {}) {
  const status = Number(error?.status) || 400;
  const message = String(error?.message || 'درخواست نامعتبر است');
  if (successField) return { status, body: { success: false, message } };
  return { status, body: { message } };
}

/** Escape JSON embedded in HTML so </script> and similar cannot break out. */
function safeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function looksTechnicalErrorMessage(message) {
  const text = String(message || '');
  return /ECONN|ENOENT|ENOTFOUND|EACCES|at\s+\S+:\d+|\/var\/|\/opt\/|C:\\|stderr|stdout|mongodb|MongoServer|openssl|nginx|Traceback|stack|Unexpected token|Expected property name|JSON at position|SyntaxError|is not valid JSON|blocked by WAF|heuristic-|sql-|xss-|path-traversal|nosql-|ldap-|Request blocked/i.test(text);
}

module.exports = {
  isClientError,
  clientErrorPayload,
  safeJsonForHtml,
  looksTechnicalErrorMessage,
};
