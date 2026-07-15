const { readAuthContext } = require('../helpers/SessionUserHelper');

/** Attaches req.user when a valid session exists; never blocks the request. */
function optionalAuthMiddleware(req, _res, next) {
  try {
    const ctx = readAuthContext(req);
    if (ctx?.user) req.user = ctx.user;
  } catch {
    // Public endpoints must continue without a session.
  }
  next();
}

module.exports = optionalAuthMiddleware;
