// Session guard: verifies the `session` cookie, loads the account and sets req.user.
// Any failure clears the cookie, because the frontend's proxy redirects on cookie *presence*
// and a dead cookie must not be left behind.
const prisma = require('../prisma');
const { ServerError } = require('../errors');
const { SESSION_COOKIE, verifySession, sessionCookieOptions } = require('../lib/jwt');

const SESSION_EXPIRED = 'Your session expired, please sign in again.';

async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];

  let account = null;
  if (token) {
    try {
      const { sub } = verifySession(token);
      account = await prisma.account.findUnique({
        where: { id: sub },
        select: { id: true, name: true, email: true, role: true, active: true },
      });
    } catch {
      // Invalid, tampered or expired token: handled below as "no account".
      account = null;
    }
  }

  if (!account || !account.active) {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    throw new ServerError(401, SESSION_EXPIRED);
  }

  // Role comes from the database row, not the token, so a role change applies immediately.
  const { id, name, email, role } = account;
  req.user = { id, name, email, role };
  next();
}

module.exports = requireAuth;
