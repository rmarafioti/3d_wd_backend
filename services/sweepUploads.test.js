// Tests for the upload cleanup (services/sweepUploads.js). Cloudinary's Admin API is played by a
// mocked fetch; the database is the real test database. Only uploads more than 24 hours old that
// no image row refers to are deleted, and only under this environment's root folder.
require('../testing/setup');
const { describe, it, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const sweepUploads = require('./sweepUploads');
const {
  resetState,
  disconnect,
  createWebsite,
  createPost,
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
  it('deletes only old uploads that no image refers to, keeping archived posts images', async () => {
    const { website } = await createWebsite({ mediaFolder: 'stevie' });
    await createPost(website, {
      active: false,
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

  it("lists only under this environment's root folder", async () => {
    const fetchMock = mockAdminApi([]);

    await sweepUploads();

    const listUrl = new URL(fetchMock.mock.calls[0].arguments[0]);
    assert.equal(listUrl.searchParams.get('prefix'), '3dwd-test/');
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});
