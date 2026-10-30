// Request tests for the public route (api/public/index.js): a client website fetching its posts
// with its API key. Covers every 401, that only this website's published posts come back, newest
// first, each body in order, that the PublicPost shape never carries postName, item ids or
// secrets, and both rate limits (per website for a valid key, per address for a refused one).
require('../../testing/setup');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../app');
const {
  resetState,
  disconnect,
  createWebsite,
  paragraph,
  imageSrc,
  imageElement,
  createPost,
} = require('../../testing/helpers');

const INVALID_KEY = { error: { message: 'Invalid API key.' } };
const TOO_MANY_REQUESTS = { error: { message: 'Too many requests. Please try again later.' } };

// An image in the website's upload folder; override any field.
function image(website, overrides = {}) {
  return { src: imageSrc(website), width: 800, height: 600, altText: 'A', ...overrides };
}

beforeEach(resetState);
after(disconnect);

function fetchPosts(apiKey) {
  return request(app).get('/api/public/posts').set('Authorization', `Bearer ${apiKey}`);
}

describe('GET /api/public/posts', () => {
  it("returns the website's published, undeleted posts, newest first, as PublicPost without postName", async () => {
    const { website, apiKey } = await createWebsite();
    const older = await createPost(website, {
      header: 'Older',
      postDate: new Date('2026-10-01T00:00:00.000Z'),
      body: [
        imageElement(image(website)),
        paragraph('Intro'),
        imageElement(image(website, { altText: 'Second' })),
        paragraph('Outro'),
      ],
    });
    const newer = await createPost(website, { header: 'Newer' });
    await createPost(website, { header: 'Draft', status: 'draft' });
    await createPost(website, { header: 'Deleted', deletedAt: new Date() });
    const { website: otherWebsite } = await createWebsite();
    await createPost(otherWebsite, { header: 'Not this website' });

    const res = await fetchPosts(apiKey);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: [
        {
          id: newer.id,
          header: 'Newer',
          subHeader: null,
          postDate: null,
          createdAt: newer.createdAt.toISOString(),
          updatedAt: newer.updatedAt.toISOString(),
          body: [{ type: 'paragraph', text: 'Body' }],
        },
        {
          id: older.id,
          header: 'Older',
          subHeader: null,
          postDate: '2026-10-01',
          createdAt: older.createdAt.toISOString(),
          updatedAt: older.updatedAt.toISOString(),
          body: [
            { type: 'image', image: image(website) },
            { type: 'paragraph', text: 'Intro' },
            { type: 'image', image: image(website, { altText: 'Second' }) },
            { type: 'paragraph', text: 'Outro' },
          ],
        },
      ],
    });
  });

  it('returns 401 without an Authorization header', async () => {
    await createWebsite();

    const res = await request(app).get('/api/public/posts');

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, INVALID_KEY);
  });

  it('returns 401 when the key is not sent as a Bearer token', async () => {
    const { apiKey } = await createWebsite();

    const res = await request(app).get('/api/public/posts').set('Authorization', apiKey);

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, INVALID_KEY);
  });

  it('returns 401 for an unknown key', async () => {
    await createWebsite();

    const res = await fetchPosts('not-a-real-key');

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, INVALID_KEY);
  });

  it('returns 401 for the key of an inactive website', async () => {
    const { website, apiKey } = await createWebsite({ active: false });
    await createPost(website);

    const res = await fetchPosts(apiKey);

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, INVALID_KEY);
  });

  it('returns 429 for the 31st request from one website within a minute, per website', async () => {
    const { apiKey } = await createWebsite();
    const other = await createWebsite();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      assert.equal((await fetchPosts(apiKey)).status, 200);
    }

    const res = await fetchPosts(apiKey);

    assert.equal(res.status, 429);
    assert.deepEqual(res.body, TOO_MANY_REQUESTS);
    assert.equal((await fetchPosts(other.apiKey)).status, 200);
  });

  it('returns 429 for the 11th refused key from one address within a minute', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal((await fetchPosts('not-a-real-key')).status, 401);
    }

    const res = await fetchPosts('not-a-real-key');

    assert.equal(res.status, 429);
    assert.deepEqual(res.body, TOO_MANY_REQUESTS);
  });

  it('does not count valid requests toward the refused key limit', async () => {
    const { apiKey } = await createWebsite();
    for (let attempt = 0; attempt < 15; attempt += 1) {
      assert.equal((await fetchPosts(apiKey)).status, 200);
    }

    const res = await fetchPosts('not-a-real-key');

    assert.equal(res.status, 401);
  });
});
