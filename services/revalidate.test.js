// Tests for the revalidation service (services/revalidate.js) on the paths a request test can't
// reach: skipped websites, failed calls and what gets logged. fetch and console.error are mocked.
require('../testing/setup');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const revalidate = require('./revalidate');
const {
  resetDatabase,
  disconnect,
  createWebsite,
  createPost,
  mockFetch,
} = require('../testing/helpers');

beforeEach(resetDatabase);
after(disconnect);

describe('revalidate', () => {
  it('makes no call for an inactive website', async (t) => {
    const { website } = await createWebsite({ active: false });
    const post = await createPost(website);
    const fetchMock = mockFetch(t.mock);

    await revalidate(website.id, post.id);

    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('makes no call for a website that does not exist', async (t) => {
    const fetchMock = mockFetch(t.mock);

    await revalidate('019a0000-0000-7000-8000-000000000000', 'post-id');

    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('logs the website id and status for a non-2xx response, never the secret', async (t) => {
    const { website, webhookSecret } = await createWebsite();
    mockFetch(t.mock, 500);
    const errorLog = t.mock.method(console, 'error', () => {});

    await revalidate(website.id, 'post-id');

    assert.equal(errorLog.mock.callCount(), 1);
    const logged = errorLog.mock.calls[0].arguments.join(' ');
    assert.equal(logged, `Revalidation failed for website ${website.id}: HTTP 500`);
    assert.ok(!logged.includes(webhookSecret));
  });

  it('resolves and logs without the secret when the call throws', async (t) => {
    const { website, webhookSecret } = await createWebsite();
    mockFetch(t.mock, new TypeError('fetch failed'));
    const errorLog = t.mock.method(console, 'error', () => {});

    await assert.doesNotReject(revalidate(website.id, 'post-id'));

    const logged = errorLog.mock.calls[0].arguments.join(' ');
    assert.equal(logged, `Revalidation failed for website ${website.id}: TypeError: fetch failed`);
    assert.ok(!logged.includes(webhookSecret));
  });

  it('logs nothing when the website answers 2xx', async (t) => {
    const { website } = await createWebsite();
    mockFetch(t.mock, 200);
    const errorLog = t.mock.method(console, 'error', () => {});

    await revalidate(website.id, 'post-id');

    assert.equal(errorLog.mock.callCount(), 0);
  });
});
