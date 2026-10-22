// Request tests for the auth routes (api/auth/index.js): login, logout and me, including the
// session cookie's flags and every 401 the contract documents. Google verification is mocked.
require('../../testing/setup');
const { describe, it, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');
const prisma = require('../../prisma');
const {
  CSRF,
  resetState,
  disconnect,
  createAdmin,
  createSiteOwner,
  sessionCookie,
  auditEvents,
  mockGoogle,
} = require('../../testing/helpers');

const NOT_AUTHORIZED = { error: { message: 'You are not authorized to log in.' } };
const SESSION_EXPIRED = { error: { message: 'Your session expired, please sign in again.' } };
const TOO_MANY_REQUESTS = { error: { message: 'Too many requests. Please try again later.' } };

beforeEach(resetState);
afterEach(() => mock.restoreAll());
after(disconnect);

function login(credential = 'google-id-token') {
  return request(app).post('/api/auth/login').set(CSRF).send({ credential });
}

function verifiedPayload(email) {
  return { email, email_verified: true };
}

// The session cookie from a response's Set-Cookie header, or undefined.
function sessionSetCookie(res) {
  return (res.headers['set-cookie'] ?? []).find((cookie) => cookie.startsWith('session='));
}

// The JWT inside the session cookie a response set.
function sessionToken(res) {
  return sessionSetCookie(res).split(';')[0].slice('session='.length);
}

describe('POST /api/auth/login', () => {
  it('signs in an administrator and returns only the role', async () => {
    const admin = await createAdmin();
    mockGoogle(mock, { payload: verifiedPayload(admin.email) });

    const res = await login();

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: { role: 'admin' } });
  });

  it('signs in a site owner and returns only the role', async () => {
    const owner = await createSiteOwner();
    mockGoogle(mock, { payload: verifiedPayload(owner.email) });

    const res = await login();

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: { role: 'site_owner' } });
  });

  it('matches the Google email case-insensitively', async () => {
    const owner = await createSiteOwner({ email: 'owner@example.com' });
    mockGoogle(mock, { payload: verifiedPayload('Owner@Example.COM') });

    const res = await login();

    assert.equal(res.status, 200);
    assert.equal(jwt.decode(sessionToken(res)).sub, owner.id);
  });

  it('puts the JWT only in the Set-Cookie header, never in the body', async () => {
    const owner = await createSiteOwner();
    mockGoogle(mock, { payload: verifiedPayload(owner.email) });

    const res = await login();

    const token = sessionToken(res);
    assert.ok(token.length > 0);
    assert.ok(!JSON.stringify(res.body).includes(token));
  });

  it('sets an httpOnly, SameSite=Lax, 24-hour cookie without Secure locally', async () => {
    const owner = await createSiteOwner();
    mockGoogle(mock, { payload: verifiedPayload(owner.email) });

    const res = await login();

    const cookie = sessionSetCookie(res);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; SameSite=Lax/);
    assert.match(cookie, /; Path=\//);
    assert.match(cookie, /; Max-Age=86400/);
    assert.doesNotMatch(cookie, /; Secure/);
    assert.doesNotMatch(cookie, /; Domain=/);
  });

  it('adds Secure and the shared parent domain in production', async (t) => {
    const owner = await createSiteOwner();
    mockGoogle(mock, { payload: verifiedPayload(owner.email) });
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_DOMAIN = '.3dwebdev.com';
    t.after(() => {
      process.env.NODE_ENV = 'test';
      delete process.env.COOKIE_DOMAIN;
    });

    const res = await login();

    const cookie = sessionSetCookie(res);
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; Domain=\.3dwebdev\.com/);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; SameSite=Lax/);
  });

  it('returns 401 when the credential is missing', async () => {
    const res = await request(app).post('/api/auth/login').set(CSRF).send({});

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, NOT_AUTHORIZED);
  });

  it('returns 401 when the credential is blank', async () => {
    const res = await login('   ');

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, NOT_AUTHORIZED);
  });

  it('returns 401 when Google rejects the token', async () => {
    mockGoogle(mock, { error: new Error('Token used too late') });

    const res = await login();

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, NOT_AUTHORIZED);
  });

  it('returns 401 when the Google email is not verified', async () => {
    const owner = await createSiteOwner();
    mockGoogle(mock, { payload: { email: owner.email, email_verified: false } });

    const res = await login();

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, NOT_AUTHORIZED);
  });

  it('returns 401 when no account has that email', async () => {
    mockGoogle(mock, { payload: verifiedPayload('nobody@example.com') });

    const res = await login();

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, NOT_AUTHORIZED);
    assert.equal(sessionSetCookie(res), undefined);
  });

  it('returns 401 for an inactive account', async () => {
    const owner = await createSiteOwner({ active: false });
    mockGoogle(mock, { payload: verifiedPayload(owner.email) });

    const res = await login();

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, NOT_AUTHORIZED);
  });

  it('records a successful login in the audit log', async () => {
    const owner = await createSiteOwner();
    mockGoogle(mock, { payload: verifiedPayload(owner.email) });

    await login();

    assert.deepEqual(await auditEvents(), [
      {
        action: 'auth.login_succeeded',
        actorId: owner.id,
        actorEmail: owner.email,
        targetType: null,
        targetId: null,
        metadata: null,
      },
    ]);
  });

  it('records a rejected Google token without an email', async () => {
    mockGoogle(mock, { error: new Error('Invalid token signature') });

    await login();

    const [event] = await auditEvents();
    assert.equal(event.action, 'auth.login_failed');
    assert.equal(event.actorId, null);
    assert.equal(event.actorEmail, null);
    assert.deepEqual(event.metadata, { reason: 'invalid_token' });
  });

  it('records the verified email as the actor email when no account has it, and still returns the same 401', async () => {
    mockGoogle(mock, { payload: verifiedPayload('nobody@example.com') });

    const res = await login();

    assert.deepEqual(res.body, NOT_AUTHORIZED);
    const [event] = await auditEvents();
    assert.equal(event.actorId, null);
    assert.equal(event.actorEmail, 'nobody@example.com');
    assert.deepEqual(event.metadata, { reason: 'no_account' });
  });

  it('records an inactive account as the actor of its failed login', async () => {
    const owner = await createSiteOwner({ active: false });
    mockGoogle(mock, { payload: verifiedPayload(owner.email) });

    const res = await login();

    assert.deepEqual(res.body, NOT_AUTHORIZED);
    const [event] = await auditEvents();
    assert.equal(event.actorId, owner.id);
    assert.equal(event.actorEmail, owner.email);
    assert.deepEqual(event.metadata, { reason: 'inactive' });
  });

  it('returns 429 for the sixth login from one address within 15 minutes', async () => {
    mockGoogle(mock, { error: new Error('Invalid token signature') });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await login()).status, 401);
    }

    const res = await login();

    assert.equal(res.status, 429);
    assert.deepEqual(res.body, TOO_MANY_REQUESTS);
    assert.ok(res.headers['ratelimit-policy']);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie and returns 204', async () => {
    const owner = await createSiteOwner();

    const res = await request(app)
      .post('/api/auth/logout')
      .set(CSRF)
      .set('Cookie', sessionCookie(owner));

    assert.equal(res.status, 204);
    assert.match(sessionSetCookie(res), /^session=;.*Expires=Thu, 01 Jan 1970/);
  });

  it('clears the cookie even without a valid session', async () => {
    const res = await request(app).post('/api/auth/logout').set(CSRF);

    assert.equal(res.status, 204);
    assert.match(sessionSetCookie(res), /^session=;/);
  });

  it('ends every session of the account, on this device and others', async () => {
    const owner = await createSiteOwner();
    const thisDevice = sessionCookie(owner);
    const otherDevice = sessionCookie(owner);

    await request(app).post('/api/auth/logout').set(CSRF).set('Cookie', thisDevice);

    const res = await request(app).get('/api/auth/me').set('Cookie', otherDevice);
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, SESSION_EXPIRED);
    assert.match(sessionSetCookie(res), /^session=;/);
    assert.deepEqual(
      (await auditEvents()).map(({ action, actorId, actorEmail }) => ({
        action,
        actorId,
        actorEmail,
      })),
      [{ action: 'auth.logout', actorId: owner.id, actorEmail: owner.email }],
    );
  });

  it('lets the account sign in again after logging out', async () => {
    const owner = await createSiteOwner();
    await request(app).post('/api/auth/logout').set(CSRF).set('Cookie', sessionCookie(owner));
    mockGoogle(mock, { payload: verifiedPayload(owner.email) });

    const signedIn = await login();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `session=${sessionToken(signedIn)}`);

    assert.equal(res.status, 200);
  });

  it('does not end newer sessions when an ended cookie is sent again', async () => {
    const owner = await createSiteOwner();
    const ended = sessionCookie(owner);
    await request(app).post('/api/auth/logout').set(CSRF).set('Cookie', ended);
    const newer = sessionCookie(await prisma.account.findUnique({ where: { id: owner.id } }));

    await request(app).post('/api/auth/logout').set(CSRF).set('Cookie', ended);

    const res = await request(app).get('/api/auth/me').set('Cookie', newer);
    assert.equal(res.status, 200);
    assert.equal((await auditEvents()).length, 1);
  });

  it('changes nothing for a cookie that does not verify', async () => {
    const owner = await createSiteOwner();
    const tampered = jwt.sign({ sub: owner.id, role: owner.role, sv: 0 }, 'some-other-secret');

    const res = await request(app)
      .post('/api/auth/logout')
      .set(CSRF)
      .set('Cookie', `session=${tampered}`);

    assert.equal(res.status, 204);
    const stored = await prisma.account.findUnique({ where: { id: owner.id } });
    assert.equal(stored.sessionVersion, 0);
    assert.deepEqual(await auditEvents(), []);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the signed-in account', async () => {
    const owner = await createSiteOwner({ name: 'Stevie', email: 'stevie@example.com' });

    const res = await request(app).get('/api/auth/me').set('Cookie', sessionCookie(owner));

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: { id: owner.id, name: 'Stevie', email: 'stevie@example.com', role: 'site_owner' },
    });
  });

  it('uses the role stored in the database, not the one in the token', async () => {
    const owner = await createSiteOwner();
    const cookie = sessionCookie(owner);
    await prisma.account.update({ where: { id: owner.id }, data: { role: 'admin' } });

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    assert.equal(res.body.data.role, 'admin');
  });

  it('returns 401 without a session cookie', async () => {
    const res = await request(app).get('/api/auth/me');

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, SESSION_EXPIRED);
  });

  it('returns 401 and clears the cookie for a tampered token', async () => {
    const owner = await createSiteOwner();
    const tampered = jwt.sign({ sub: owner.id, role: 'admin' }, 'some-other-secret');

    const res = await request(app).get('/api/auth/me').set('Cookie', `session=${tampered}`);

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, SESSION_EXPIRED);
    assert.match(sessionSetCookie(res), /^session=;/);
  });

  it('returns 401 and clears the cookie for an expired token', async () => {
    const owner = await createSiteOwner();
    const expired = jwt.sign(
      { sub: owner.id, role: owner.role, exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET,
    );

    const res = await request(app).get('/api/auth/me').set('Cookie', `session=${expired}`);

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, SESSION_EXPIRED);
    assert.match(sessionSetCookie(res), /^session=;/);
  });

  it('returns 401 for a token that picks its own algorithm', async () => {
    const owner = await createSiteOwner();
    const unsigned = jwt.sign({ sub: owner.id, role: owner.role }, null, { algorithm: 'none' });

    const res = await request(app).get('/api/auth/me').set('Cookie', `session=${unsigned}`);

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, SESSION_EXPIRED);
  });

  it('returns 401 and clears the cookie once the account is inactive', async () => {
    const owner = await createSiteOwner();
    const cookie = sessionCookie(owner);
    await prisma.account.update({ where: { id: owner.id }, data: { active: false } });

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, SESSION_EXPIRED);
    assert.match(sessionSetCookie(res), /^session=;/);
  });

  it('returns 401 for a token from before session versions', async () => {
    const owner = await createSiteOwner();
    const versionless = jwt.sign({ sub: owner.id, role: owner.role }, process.env.JWT_SECRET);

    const res = await request(app).get('/api/auth/me').set('Cookie', `session=${versionless}`);

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, SESSION_EXPIRED);
  });

  it('returns 401 when the account no longer exists', async () => {
    const owner = await createSiteOwner();
    const cookie = sessionCookie(owner);
    await resetState();

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, SESSION_EXPIRED);
  });
});
