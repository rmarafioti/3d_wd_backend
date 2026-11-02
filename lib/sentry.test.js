// Tests for lib/sentry.js: what an event may carry. scrubEvent is tested directly, then Sentry is
// turned on in this process with a transport that records envelopes instead of sending them, and
// real requests prove a 500 reaches Sentry with nothing a user sent and no secret in it, while an
// expected error never reports. Sentry stays off in every other test file (testing/setup.js).
require('../testing/setup');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Sentry = require('@sentry/node');
const { initSentry, scrubEvent, reportError, flushSentry } = require('./sentry');
const { resetState, disconnect, createWebsite, mockFetch } = require('../testing/helpers');

after(disconnect);

const TEST_DSN = 'https://public@o0.ingest.sentry.io/0';
const SESSION_VALUE = 'session-cookie-value-123';
const BEARER = 'Bearer api-key-456';

// An error event as the SDK builds it before beforeSend, with everything scrubEvent must remove.
function rawEvent() {
  return {
    message: `Lost ${process.env.DATABASE_URL}`,
    exception: {
      values: [
        {
          type: 'Error',
          value: `Failed with ${process.env.CLOUDINARY_API_SECRET} at postgres://u:p@db:5432/x`,
        },
      ],
    },
    request: {
      method: 'POST',
      url: 'https://api.3dwebdev.com/api/siteOwner/posts?token=abc',
      headers: { authorization: BEARER, cookie: `session=${SESSION_VALUE}` },
      cookies: { session: SESSION_VALUE },
      data: '{"postName":"Private"}',
      query_string: 'token=abc',
    },
    user: { id: 'u1', ip_address: '203.0.113.9' },
    breadcrumbs: [{ message: 'fetch https://example.com' }],
    extra: { body: 'Private' },
    contexts: { request: { headers: {} }, response: { status_code: 500 }, os: { name: 'Linux' } },
  };
}

describe('scrubEvent', () => {
  it("keeps only the request's method and path, and drops user, breadcrumbs and extra", () => {
    const event = scrubEvent(rawEvent());

    assert.deepEqual(event.request, {
      method: 'POST',
      url: 'https://api.3dwebdev.com/api/siteOwner/posts',
    });
    assert.equal(event.user, undefined);
    assert.equal(event.breadcrumbs, undefined);
    assert.equal(event.extra, undefined);
    assert.deepEqual(event.contexts, { os: { name: 'Linux' } });
  });

  it("redacts every secret's value and any Postgres URL from the messages", () => {
    const event = scrubEvent(rawEvent());

    assert.equal(event.message, 'Lost [redacted]');
    assert.equal(event.exception.values[0].value, 'Failed with [redacted] at [redacted]');
  });

  it('leaves an event without a request or exception as it is', () => {
    assert.deepEqual(scrubEvent({ message: 'plain' }), { message: 'plain' });
  });
});

describe('while Sentry is off', () => {
  it('reports nothing and flushes nothing', async () => {
    assert.equal(Sentry.isInitialized(), false);

    reportError(new Error('ignored'));

    assert.equal(await flushSentry(), false);
  });
});

describe('reporting through the error handler', () => {
  const sent = [];
  let app;

  before(() => {
    process.env.SENTRY_DSN = TEST_DSN;
    initSentry({
      transport: (options) =>
        Sentry.createTransport(options, (req) => {
          // Only error events; the SDK's own client reports (counts of dropped data) are skipped.
          const envelope = Buffer.from(req.body).toString('utf8');
          if (envelope.includes('"type":"event"')) sent.push(envelope);
          return Promise.resolve({ statusCode: 200 });
        }),
    });
    // Required only after Sentry starts, as index.js does, so Sentry sees Express load.
    const express = require('express');
    const { errorHandler, ServerError } = require('../errors');
    app = express();
    app.use(express.json());
    app.post('/boom', () => {
      throw new Error(`Query failed using ${process.env.CLOUDINARY_API_SECRET}`);
    });
    app.post('/missing', () => {
      throw new ServerError(404, 'Post not found.');
    });
    app.use(errorHandler);
  });

  // Sends a request carrying everything a user might send: a key, a session cookie and a body.
  function send(path, t) {
    t.mock.method(console, 'error', () => {});
    return require('supertest')(app)
      .post(`${path}?token=abc`)
      .set('Authorization', BEARER)
      .set('Cookie', `session=${SESSION_VALUE}`)
      .send({ postName: 'Private post' });
  }

  it('sends a 500 with its scrubbed message and nothing the user sent', async (t) => {
    sent.length = 0;

    const res = await send('/boom', t);
    await flushSentry();

    assert.equal(res.status, 500);
    assert.equal(sent.length, 1);
    const [envelope] = sent;
    assert.ok(envelope.includes('Query failed using [redacted]'));
    // The request was seen, so the scrub had headers, cookies and a body to remove.
    assert.ok(envelope.includes('"method":"POST"'));
    assert.ok(envelope.includes('/boom'));
    for (const leak of [
      process.env.CLOUDINARY_API_SECRET,
      SESSION_VALUE,
      'api-key-456',
      'Private post',
      'token=abc',
    ]) {
      assert.ok(!envelope.includes(leak), `the event must not contain ${leak}`);
    }
  });

  it('sends nothing for an expected error', async (t) => {
    sent.length = 0;

    const res = await send('/missing', t);
    await flushSentry();

    assert.equal(res.status, 404);
    assert.equal(sent.length, 0);
  });

  it('sends a failed revalidation as one warning per website, with no URL or secret', async (t) => {
    await resetState();
    const revalidate = require('../services/revalidate');
    const { website, webhookSecret } = await createWebsite();
    mockFetch(t.mock, 401);
    t.mock.method(console, 'error', () => {});
    sent.length = 0;

    await revalidate(website.id, { postId: 'p1' });
    await flushSentry();

    assert.equal(sent.length, 1);
    const [envelope] = sent;
    assert.ok(envelope.includes(`Revalidation failed for website ${website.id}: HTTP 401`));
    assert.ok(envelope.includes('"level":"warning"'));
    assert.ok(envelope.includes(`"fingerprint":["revalidation","${website.id}"]`));
    assert.ok(!envelope.includes(webhookSecret));
    assert.ok(!envelope.includes(website.url));
  });
});
