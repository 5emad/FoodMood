/**
 * Strips MongoDB operator keys (starting with $ or containing .)
 * from req.body, req.query, and req.params to prevent NoSQL injection.
 */

function sanitize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitize);

  const cleaned = {};
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) continue;
    cleaned[key] = sanitize(value[key]);
  }
  return cleaned;
}

const mongoSanitize = (req, _res, next) => {
  if (req.body)   req.body   = sanitize(req.body);
  if (req.query)  req.query  = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);
  next();
};

module.exports = mongoSanitize;
