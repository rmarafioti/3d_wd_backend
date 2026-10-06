// Role gate, used after requireAuth: only lets the request through when the signed-in
// account's role (loaded from the database by requireAuth) matches the router's role.
const { ServerError } = require('../errors');

function requireRole(role) {
  return function checkRole(req, res, next) {
    if (req.user?.role !== role) {
      throw new ServerError(403, 'You do not have access to this page.');
    }
    next();
  };
}

module.exports = requireRole;
