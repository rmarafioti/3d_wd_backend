// Auth routes, mounted at /api/auth: login (Google ID token → session cookie), logout (ends every
// session of the account), me. Login and logout write audit events (lib/audit.js).
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const requireAuth = require('../../middleware/requireAuth');
const {
  SESSION_COOKIE,
  signSession,
  verifySession,
  sessionCookieOptions,
} = require('../../lib/jwt');
const { AUDIT_ACTIONS, recordAuditEvent } = require('../../lib/audit');
const { loginRateLimit } = require('../../lib/rateLimit');
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

// Records why a login failed, then throws the one 401 every failure shares. The reason and the
// email stay in the audit log and never reach the response. actorEmail is only ever a
// Google-verified email: an invalid token has none.
async function failLogin(req, { reason, actorId, actorEmail }) {
  await recordAuditEvent(prisma, req, {
    action: AUDIT_ACTIONS.LOGIN_FAILED,
    actorId,
    actorEmail,
    metadata: { reason },
  });
  throw new ServerError(401, NOT_AUTHORIZED);
}

// The session a cookie belongs to ({ sub, sv }), or null when it is missing, doesn't verify or has
// no sv (a token from before session versions). Prisma skips an undefined filter, so a missing sv
// must never reach the logout update.
function cookieSession(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const session = verifySession(token);
    return Number.isInteger(session.sv) ? session : null;
  } catch {
    return null;
  }
}

// POST /api/auth/login — body { credential }. Sets the session cookie, returns { role }.
router.post('/login', loginRateLimit, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) return failLogin(req, { reason: 'invalid_token' });

  const email = await verifiedGoogleEmail(parsed.data.credential);
  if (!email) return failLogin(req, { reason: 'invalid_token' });

  // Matched by email only; the Google display name is never compared.
  const account = await prisma.account.findUnique({
    where: { email },
    select: { id: true, role: true, active: true, sessionVersion: true },
  });
  if (!account) return failLogin(req, { reason: 'no_account', actorEmail: email });
  if (!account.active) {
    return failLogin(req, { reason: 'inactive', actorId: account.id, actorEmail: email });
  }

  await recordAuditEvent(prisma, req, {
    action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
    actorId: account.id,
    actorEmail: email,
  });

  // The token goes only in Set-Cookie, never in the JSON body.
  res.cookie(SESSION_COOKIE, signSession(account), sessionCookieOptions());
  res.json({ data: { role: account.role } });
});

// POST /api/auth/logout — ends every session of the account: bumping its session version makes
// every cookie issued before now fail requireAuth, on this device and any other. The sv condition
// means an old, already-ended cookie can't end the newer sessions again. Always clears this
// browser's cookie and returns 204, whether or not the cookie was valid.
router.post('/logout', async (req, res) => {
  const session = cookieSession(req);
  if (session) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.account.updateMany({
        where: { id: session.sub, sessionVersion: session.sv },
        data: { sessionVersion: { increment: 1 } },
      });
      if (count === 0) return;
      // The cookie carries no email, so it is read from the account for the audit row.
      const account = await tx.account.findUnique({
        where: { id: session.sub },
        select: { email: true },
      });
      await recordAuditEvent(tx, req, {
        action: AUDIT_ACTIONS.LOGOUT,
        actorId: session.sub,
        actorEmail: account.email,
      });
    });
  }

  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.status(204).end();
});

// GET /api/auth/me — who is signed in, for the frontend layouts after a page refresh.
router.get('/me', requireAuth, (req, res) => {
  res.json({ data: req.user });
});

module.exports = router;
