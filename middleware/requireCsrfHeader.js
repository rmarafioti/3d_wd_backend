// CSRF guard: every state-changing request must carry X-CSRF-Protection: 1. A cross-site form
// can't set custom headers, and a cross-origin fetch with one needs a CORS preflight that only
// CORS_ORIGIN passes. GET (and the OPTIONS preflight, already answered by cors) pass through.
const { ServerError } = require('../errors');

const PROTECTED_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

function requireCsrfHeader(req, res, next) {
  if (PROTECTED_METHODS.has(req.method) && req.get('X-CSRF-Protection') !== '1') {
    throw new ServerError(403, 'Request blocked.');
  }
  next();
}

module.exports = requireCsrfHeader;
