// Request tests for the app-level middleware stack (app.js): health check, unknown routes,
// malformed JSON, the CSRF header and CORS.
require('./testing/setup');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('./app');
const { CSRF, disconnect } = require('./testing/helpers');

after(disconnect);

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
