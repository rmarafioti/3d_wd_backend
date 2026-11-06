// Tests for the scheduled publish job (services/publishScheduled.js): the revalidation call is a
// mocked fetch, and the database is the real test database.
require('../testing/setup');
const { describe, it, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../prisma');
const publishScheduled = require('./publishScheduled');
const {
  resetState,
  disconnect,
  createWebsite,
  createPost,
  createGallery,
  createAbility,
  auditEvents,
  mockFetch,
} = require('../testing/helpers');

const MINUTE_MS = 60 * 1000;
const past = () => new Date(Date.now() - MINUTE_MS);
const future = () => new Date(Date.now() + 60 * MINUTE_MS);

beforeEach(resetState);
afterEach(() => mock.restoreAll());
after(disconnect);

// The body of each revalidation call the job sent. The calls run at once, so they are sorted
// (post before gallery) rather than read in send order.
function revalidationBodies(fetchMock) {
  return fetchMock.mock.calls
    .map(({ arguments: [, options] }) => JSON.parse(options.body))
    .sort((a, b) => Number(Boolean(b.postId)) - Number(Boolean(a.postId)));
}

describe('publishScheduled', () => {
  it('publishes the due drafts, stamps publishedAt, clears publishAt and audits with no actor', async () => {
    const fetchMock = mockFetch(mock);
    const { website } = await createWebsite();
    const post = await createPost(website, { status: 'draft', publishAt: past() });
    const gallery = await createGallery(website, { status: 'draft', publishAt: past() });

    const now = new Date();
    const counts = await publishScheduled(now);

    assert.deepEqual(counts, { posts: 1, galleries: 1 });
    const storedPost = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    const storedGallery = await prisma.gallery.findUniqueOrThrow({ where: { id: gallery.id } });
    for (const stored of [storedPost, storedGallery]) {
      assert.equal(stored.status, 'published');
      assert.equal(stored.publishAt, null);
      assert.deepEqual(stored.publishedAt, now);
    }
    const event = (action, targetType, targetId) => ({
      action,
      actorId: null,
      actorEmail: null,
      targetType,
      targetId,
      metadata: { websiteId: website.id, scheduled: true },
    });
    assert.deepEqual(await auditEvents(), [
      event('post.published', 'post', post.id),
      event('gallery.published', 'gallery', gallery.id),
    ]);
    assert.deepEqual(revalidationBodies(fetchMock), [
      { websiteId: website.id, postId: post.id },
      { websiteId: website.id, galleryId: gallery.id },
    ]);
  });

  it('leaves a future, deleted, unscheduled or already published item untouched', async () => {
    const fetchMock = mockFetch(mock);
    const { website } = await createWebsite();
    const untouched = [
      await createPost(website, { status: 'draft', publishAt: future() }),
      await createPost(website, { status: 'draft', publishAt: past(), deletedAt: past() }),
      await createPost(website, { status: 'draft' }),
      await createPost(website, { publishAt: past() }),
    ];

    const counts = await publishScheduled();

    assert.deepEqual(counts, { posts: 0, galleries: 0 });
    for (const post of untouched) {
      const stored = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
      assert.equal(stored.status, post.status);
      assert.equal(stored.publishAt?.getTime(), post.publishAt?.getTime());
    }
    assert.deepEqual(await auditEvents(), []);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('publishes nothing on a second run', async () => {
    mockFetch(mock);
    const { website } = await createWebsite();
    await createPost(website, { status: 'draft', publishAt: past() });

    await publishScheduled();
    const counts = await publishScheduled();

    assert.deepEqual(counts, { posts: 0, galleries: 0 });
    assert.equal((await auditEvents()).length, 1);
  });

  it('still publishes every due item when a revalidation call fails', async () => {
    mockFetch(mock, new TypeError('fetch failed'));
    mock.method(console, 'error', () => {});
    const { website } = await createWebsite();
    await createPost(website, { status: 'draft', publishAt: past() });
    await createPost(website, { status: 'draft', publishAt: past() });

    const counts = await publishScheduled();

    assert.deepEqual(counts, { posts: 2, galleries: 0 });
    assert.equal(await prisma.post.count({ where: { status: 'published' } }), 2);
  });

  it('publishes a gallery while Photo Galleries is off, which keeps it off the website', async () => {
    mockFetch(mock);
    const { website, apiKey } = await createWebsite();
    await createAbility(website, 'galleries', { status: 'live', turnedOn: false });
    const gallery = await createGallery(website, { status: 'draft', publishAt: past() });

    await publishScheduled();

    const stored = await prisma.gallery.findUniqueOrThrow({ where: { id: gallery.id } });
    assert.equal(stored.status, 'published');
    const res = await request(app)
      .get(`/api/public/galleries/${gallery.slug}`)
      .set('Authorization', `Bearer ${apiKey}`);
    assert.equal(res.status, 404);
  });
});
