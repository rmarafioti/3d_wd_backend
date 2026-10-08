// Request tests for the public route (api/public/index.js): a client website fetching its posts
// with its API key. Covers every 401, that only this website's active posts come back, newest
// first, each body in order, and that the PublicPost shape never carries postName, item ids or
// secrets.
require('../../testing/setup');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../app');
const {
  resetDatabase,
  disconnect,
  createWebsite,
  paragraph,
  imageElement,
  createPost,
} = require('../../testing/helpers');

const INVALID_KEY = { error: { message: 'Invalid API key.' } };

const IMAGE = { src: 'https://res.cloudinary.com/a.jpg', width: 800, height: 600, altText: 'A' };
const LINK = { name: 'Shop', url: 'https://shop.example.com' };

beforeEach(resetDatabase);
after(disconnect);

function fetchPosts(apiKey) {
  return request(app).get('/api/public/posts').set('Authorization', `Bearer ${apiKey}`);
}

describe('GET /api/public/posts', () => {
  it("returns the website's active posts, newest first, as PublicPost without postName", async () => {
    const { website, apiKey } = await createWebsite();
    const older = await createPost(website, {
      header: 'Older',
      postDate: new Date('2026-10-01T00:00:00.000Z'),
      body: [
        imageElement(IMAGE),
        paragraph('Intro'),
        imageElement({ ...IMAGE, altText: 'Second' }),
        paragraph('Outro'),
      ],
      links: [LINK],
    });
    const newer = await createPost(website, { header: 'Newer' });
    await createPost(website, { header: 'Archived', active: false });
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
          links: [],
        },
        {
          id: older.id,
          header: 'Older',
          subHeader: null,
          postDate: '2026-10-01',
          createdAt: older.createdAt.toISOString(),
          updatedAt: older.updatedAt.toISOString(),
          body: [
            { type: 'image', image: IMAGE },
            { type: 'paragraph', text: 'Intro' },
            { type: 'image', image: { ...IMAGE, altText: 'Second' } },
            { type: 'paragraph', text: 'Outro' },
          ],
          links: [LINK],
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
});
