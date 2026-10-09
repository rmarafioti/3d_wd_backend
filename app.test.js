// Request tests for the app-level middleware stack (app.js): health check, unknown routes,
// malformed JSON, the JSON body limit, the CSRF header and CORS.
require('./testing/setup');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('./app');
const { CSRF, disconnect, mockGoogle } = require('./testing/helpers');

const BODY_LIMIT_BYTES = 256 * 1024;

after(disconnect);

// A login request whose JSON body is exactly `bytes` bytes (the login route needs no session).
function loginWithBodyOfSize(bytes) {
  const credential = 'a'.repeat(bytes - JSON.stringify({ credential: '' }).length);
  return request(app)
    .post('/api/auth/login')
    .set(CSRF)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ credential }));
}

describe('app', () => {
  it('answers the health check', async () => {
    const res = await request(app).get('/api/health');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: { ok: true } });
  });

  it('returns the JSON 404 envelope for an unknown route', async () => {
    const res = await request(app).get('/api/nope');

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: { message: 'Not found.' } });
  });

  it('returns 400 for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .set('Content-Type', 'application/json')
      .send('{"credential":');

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: { message: 'Invalid request body.' } });
  });

  it('returns 413 for a JSON body over 256kb', async () => {
    const res = await loginWithBodyOfSize(BODY_LIMIT_BYTES + 1);

    assert.equal(res.status, 413);
    assert.deepEqual(res.body, { error: { message: 'Request body is too large.' } });
  });

  it('passes a JSON body of exactly 256kb to the route', async (t) => {
    // The route verifies the credential with Google; mocked so no call leaves the machine.
    const verify = mockGoogle(t.mock, { error: new Error('Invalid token') });

    const res = await loginWithBodyOfSize(BODY_LIMIT_BYTES);

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: { message: 'You are not authorized to log in.' } });
    assert.equal(verify.mock.callCount(), 1);
  });

  for (const method of ['post', 'patch', 'delete']) {
    it(`blocks a ${method.toUpperCase()} without the CSRF header before any route runs`, async () => {
      const res = await request(app)[method]('/api/siteOwner/posts/some-id');

      assert.equal(res.status, 403);
      assert.deepEqual(res.body, { error: { message: 'Request blocked.' } });
    });
  }

  it('blocks a POST whose CSRF header is not exactly 1', async () => {
    const res = await request(app).post('/api/auth/logout').set('X-CSRF-Protection', 'true');

    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: { message: 'Request blocked.' } });
  });

  it('allows exactly CORS_ORIGIN with credentials, never a wildcard', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:3000');

    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:3000');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  });

  it('allows the CSRF and Authorization headers on a preflight', async () => {
    const res = await request(app)
      .options('/api/siteOwner/posts')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');

    assert.equal(res.status, 204);
    assert.equal(
      res.headers['access-control-allow-headers'],
      'Content-Type,X-CSRF-Protection,Authorization',
    );
  });
});
