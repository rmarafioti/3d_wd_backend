// CSRF guard: every POST, PATCH and DELETE must carry X-CSRF-Protection: 1, or it is a 403.
const { ServerError } = require('../errors');

const PROTECTED_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

// A cross-site form can't set custom headers, and a cross-origin fetch with one needs a CORS
// preflight that only CORS_ORIGIN passes. GET and the OPTIONS preflight (answered by cors) pass.
function requireCsrfHeader(req, res, next) {
  if (PROTECTED_METHODS.has(req.method) && req.get('X-CSRF-Protection') !== '1') {
    throw new ServerError(403, 'Request blocked.');
  }
  next();
}

module.exports = requireCsrfHeader;
