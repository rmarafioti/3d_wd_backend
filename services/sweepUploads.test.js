// Tests for the upload cleanup (services/sweepUploads.js). Cloudinary's Admin API is played by a
// mocked fetch; the database is the real test database. Only uploads more than 24 hours old that
// no kept post or gallery image row refers to are deleted, and only under this environment's root
// folder. A deleted post's or gallery's images are kept for 30 days after its deletion.
require('../testing/setup');
const { describe, it, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const sweepUploads = require('./sweepUploads');
const {
  resetState,
  disconnect,
  createWebsite,
  createPost,
  createGallery,
  paragraph,
  imageElement,
  imageSrc,
} = require('../testing/helpers');

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(resetState);
afterEach(() => mock.restoreAll());
after(disconnect);

// Plays the Admin API: the list call returns `resources`; delete calls are recorded.
function mockAdminApi(resources) {
  return mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'DELETE') return Response.json({ deleted: {} });
    return Response.json({ resources });
  });
}

function deletedIds(fetchMock) {
  return fetchMock.mock.calls
    .filter(({ arguments: [, options] }) => options?.method === 'DELETE')
    .flatMap(({ arguments: [url] }) => new URL(url).searchParams.getAll('public_ids[]'));
}

function uploadedAgo(publicId, ms) {
  return { public_id: publicId, created_at: new Date(Date.now() - ms).toISOString() };
}

describe('sweepUploads', () => {
  it("deletes only old uploads that no image refers to, keeping draft posts' images", async () => {
    const { website } = await createWebsite({ mediaFolder: 'stevie' });
    await createPost(website, {
      status: 'draft',
      body: [
        paragraph(),
        imageElement({ src: imageSrc(website, 'kept'), width: 1, height: 1, altText: 'A' }),
      ],
    });
    const fetchMock = mockAdminApi([
      uploadedAgo('3dwd-test/stevie/kept', 2 * DAY_MS),
      uploadedAgo('3dwd-test/stevie/removed', 2 * DAY_MS),
      uploadedAgo('3dwd-test/stevie/fresh', DAY_MS / 2),
    ]);

    const result = await sweepUploads();

    assert.deepEqual(result, { checked: 3, deleted: 1 });
    assert.deepEqual(deletedIds(fetchMock), ['3dwd-test/stevie/removed']);
  });

  it('keeps a deleted post images for 30 days, then deletes them', async () => {
    const { website } = await createWebsite({ mediaFolder: 'stevie' });
    for (const [name, deletedAgo] of [
      ['recent', 29 * DAY_MS],
      ['expired', 31 * DAY_MS],
    ]) {
      await createPost(website, {
        deletedAt: new Date(Date.now() - deletedAgo),
        body: [
          paragraph(),
          imageElement({ src: imageSrc(website, name), width: 1, height: 1, altText: 'A' }),
        ],
      });
    }
    const fetchMock = mockAdminApi([
      uploadedAgo('3dwd-test/stevie/recent', 40 * DAY_MS),
      uploadedAgo('3dwd-test/stevie/expired', 40 * DAY_MS),
    ]);

    const result = await sweepUploads();

    assert.deepEqual(result, { checked: 2, deleted: 1 });
    assert.deepEqual(deletedIds(fetchMock), ['3dwd-test/stevie/expired']);
  });

  it('keeps an image a deleted post shares with a post that is not deleted', async () => {
    const { website } = await createWebsite({ mediaFolder: 'stevie' });
    const shared = { src: imageSrc(website, 'shared'), width: 1, height: 1, altText: 'A' };
    await createPost(website, {
      deletedAt: new Date(Date.now() - 31 * DAY_MS),
      body: [paragraph(), imageElement(shared)],
    });
    await createPost(website, { body: [paragraph(), imageElement(shared)] });
    const fetchMock = mockAdminApi([uploadedAgo('3dwd-test/stevie/shared', 40 * DAY_MS)]);

    const result = await sweepUploads();

    assert.deepEqual(result, { checked: 1, deleted: 0 });
    assert.deepEqual(deletedIds(fetchMock), []);
  });

  it("keeps gallery images, and a deleted gallery's for 30 days, then deletes them", async () => {
    const { website } = await createWebsite({ mediaFolder: 'stevie' });
    const galleryImage = (name) => ({
      src: imageSrc(website, name),
      width: 1,
      height: 1,
      altText: 'A',
    });
    await createGallery(website, { status: 'draft', images: [galleryImage('draft')] });
    await createGallery(website, {
      deletedAt: new Date(Date.now() - 29 * DAY_MS),
      images: [galleryImage('recent')],
    });
    await createGallery(website, {
      deletedAt: new Date(Date.now() - 31 * DAY_MS),
      images: [galleryImage('expired'), galleryImage('shared')],
    });
    await createPost(website, { body: [paragraph(), imageElement(galleryImage('shared'))] });
    const fetchMock = mockAdminApi(
      ['draft', 'recent', 'expired', 'shared'].map((name) =>
        uploadedAgo(`3dwd-test/stevie/${name}`, 40 * DAY_MS),
      ),
    );

    const result = await sweepUploads();

    assert.deepEqual(result, { checked: 4, deleted: 1 });
    assert.deepEqual(deletedIds(fetchMock), ['3dwd-test/stevie/expired']);
  });

  it("lists only under this environment's root folder", async () => {
    const fetchMock = mockAdminApi([]);

    await sweepUploads();

    const listUrl = new URL(fetchMock.mock.calls[0].arguments[0]);
    assert.equal(listUrl.searchParams.get('prefix'), '3dwd-test/');
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});
