// Session JWT helpers: signing, verifying and the cookie options the token is stored with.
// The token only ever travels in the `session` httpOnly cookie, never in a JSON body.
const jwt = require('jsonwebtoken');

const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // fixed 24 hours, no refresh or sliding expiry

// Payload is { sub: account id, role }.
function signSession(account) {
  return jwt.sign({ sub: account.id, role: account.role }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: SESSION_TTL_MS / 1000,
  });
}

// Throws if the token is invalid, tampered with or expired. The algorithm is pinned so a
// token can't pick its own.
function verifySession(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}

// Used both to set and to clear the cookie: a cookie is only cleared when path and domain match.
// Production: Secure, Domain=.3dwebdev.com (COOKIE_DOMAIN). Local: not Secure, no domain.
function sessionCookieOptions() {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
  if (process.env.COOKIE_DOMAIN) options.domain = process.env.COOKIE_DOMAIN;
  return options;
}

module.exports = { SESSION_COOKIE, signSession, verifySession, sessionCookieOptions };
