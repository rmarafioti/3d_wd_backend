// Auth routes, mounted at /api/auth: login (Google ID token → session cookie), logout, me.
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const requireAuth = require('../../middleware/requireAuth');
const { SESSION_COOKIE, signSession, sessionCookieOptions } = require('../../lib/jwt');
const { loginSchema } = require('../../validation/auth');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// One message for every login failure, so nobody can probe which emails have accounts.
const NOT_AUTHORIZED = 'You are not authorized to log in.';

// Verifies the Google ID token (signature, expiry, audience) and returns its verified email,
// or null on any failure. Errors are swallowed on purpose: they are all the same 401, and the
// token must never be logged.
async function verifiedGoogleEmail(credential) {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || payload.email_verified !== true || !payload.email) return null;
    return payload.email.toLowerCase();
  } catch {
    return null;
  }
}

// POST /api/auth/login — body { credential }. Sets the session cookie, returns { role }.
router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new ServerError(401, NOT_AUTHORIZED);

  const email = await verifiedGoogleEmail(parsed.data.credential);
  if (!email) throw new ServerError(401, NOT_AUTHORIZED);

  // Matched by email only; the Google display name is never compared.
  const account = await prisma.account.findUnique({
    where: { email },
    select: { id: true, role: true, active: true },
  });
  if (!account || !account.active) throw new ServerError(401, NOT_AUTHORIZED);

  // The token goes only in Set-Cookie, never in the JSON body.
  res.cookie(SESSION_COOKIE, signSession(account), sessionCookieOptions());
  res.json({ data: { role: account.role } });
});

// POST /api/auth/logout — clears the cookie whether or not it was valid.
router.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.status(204).end();
});

// GET /api/auth/me — who is signed in, for the frontend layouts after a page refresh.
router.get('/me', requireAuth, (req, res) => {
  res.json({ data: req.user });
});

module.exports = router;
