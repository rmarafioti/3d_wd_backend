// Tests for lib/cloudinary.js: the upload signature against a value computed outside the code,
// the image src folder rule, cropped URLs, public ids, and the Admin API calls the upload cleanup makes (fetch
// is mocked, so nothing reaches Cloudinary).
require('../testing/setup');
const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const {
  signUpload,
  isInFolder,
  croppedSrc,
  publicIdFromSrc,
  listUploads,
  deleteUploads,
} = require('./cloudinary');

const BASE = 'https://res.cloudinary.com/test-cloud/image/upload';

afterEach(() => mock.restoreAll());

describe('signUpload', () => {
  it('signs the parameters by Cloudinary rule with the API secret', () => {
    mock.method(Date, 'now', () => 1760000000 * 1000);

    const { uploadUrl, fields } = signUpload('steviethedog');

    assert.equal(uploadUrl, 'https://api.cloudinary.com/v1_1/test-cloud/image/upload');
    assert.deepEqual(fields, {
      allowed_formats: 'jpg,jpeg,png,webp',
      folder: '3dwd-test/steviethedog',
      timestamp: 1760000000,
      transformation: 'c_limit,w_2500,h_2500',
      // SHA-1 of the sorted key=value string + "test-cloudinary-secret", computed with shasum.
      signature: '457b2916494825cd4b275fc7bfc4a8e2a70bbb0a',
      api_key: 'test-cloudinary-key',
    });
  });
});

describe('isInFolder', () => {
  it('accepts a secure_url directly inside the website folder', () => {
    assert.equal(
      isInFolder(`${BASE}/v1760000000/3dwd-test/steviethedog/abc123.jpg`, 'steviethedog'),
      true,
    );
  });

  const rejected = [
    ['another website folder', `${BASE}/v1/3dwd-test/otherdog/abc.jpg`],
    ['a folder that only starts with the name', `${BASE}/v1/3dwd-test/steviethedog-2/abc.jpg`],
    ['a nested folder', `${BASE}/v1/3dwd-test/steviethedog/sub/abc.jpg`],
    ['another environment root', `${BASE}/v1/3dwd/steviethedog/abc.jpg`],
    [
      'another cloud',
      'https://res.cloudinary.com/other-cloud/image/upload/v1/3dwd-test/steviethedog/abc.jpg',
    ],
    [
      'another host',
      'https://evil.example.com/test-cloud/image/upload/v1/3dwd-test/steviethedog/abc.jpg',
    ],
    ['http', `http://res.cloudinary.com/test-cloud/image/upload/v1/3dwd-test/steviethedog/abc.jpg`],
    ['no version', `${BASE}/3dwd-test/steviethedog/abc.jpg`],
    ['a transformation segment', `${BASE}/w_100/v1/3dwd-test/steviethedog/abc.jpg`],
    ['a .. segment', `${BASE}/v1/3dwd-test/otherdog/../steviethedog/abc.jpg`],
    ['a query string', `${BASE}/v1/3dwd-test/steviethedog/abc.jpg?x=1`],
    ['not a URL', 'not a url'],
  ];

  for (const [label, src] of rejected) {
    it(`rejects ${label}`, () => {
      assert.equal(isInFolder(src, 'steviethedog'), false);
    });
  }
});

describe('croppedSrc', () => {
  it('puts the crop after /image/upload/, keeping the version and public id', () => {
    assert.equal(
      croppedSrc(`${BASE}/v1760000000/3dwd-test/steviethedog/abc123.jpg`, {
        x: 10,
        y: 0,
        width: 400,
        height: 500,
      }),
      `${BASE}/c_crop,x_10,y_0,w_400,h_500/v1760000000/3dwd-test/steviethedog/abc123.jpg`,
    );
  });
});

describe('publicIdFromSrc', () => {
  it('returns the path after the version, without the extension', () => {
    assert.equal(
      publicIdFromSrc(`${BASE}/v1760000000/3dwd-test/steviethedog/abc123.jpg`),
      '3dwd-test/steviethedog/abc123',
    );
  });
});

describe('listUploads', () => {
  it('pages through the Admin API with Basic auth and returns every upload', async () => {
    const pages = [
      { resources: [{ public_id: 'a', created_at: '2026-10-01T00:00:00Z' }], next_cursor: 'next' },
      { resources: [{ public_id: 'b', created_at: '2026-10-02T00:00:00Z' }] },
    ];
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json(pages.shift()));

    const uploads = await listUploads('3dwd-test/');

    assert.deepEqual(uploads, [
      { publicId: 'a', createdAt: new Date('2026-10-01T00:00:00Z') },
      { publicId: 'b', createdAt: new Date('2026-10-02T00:00:00Z') },
    ]);
    const [firstUrl, { headers }] = fetchMock.mock.calls[0].arguments;
    const first = new URL(firstUrl);
    assert.equal(
      first.origin + first.pathname,
      'https://api.cloudinary.com/v1_1/test-cloud/resources/image/upload',
    );
    assert.equal(first.searchParams.get('prefix'), '3dwd-test/');
    const auth = Buffer.from('test-cloudinary-key:test-cloudinary-secret').toString('base64');
    assert.equal(headers.Authorization, `Basic ${auth}`);
    assert.equal(
      new URL(fetchMock.mock.calls[1].arguments[0]).searchParams.get('next_cursor'),
      'next',
    );
  });

  it('throws with the status only when the Admin API fails', async () => {
    mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }));

    await assert.rejects(listUploads('3dwd-test/'), (err) => {
      assert.equal(err.message, 'Cloudinary list failed: HTTP 401');
      return true;
    });
  });
});

describe('deleteUploads', () => {
  it('deletes in batches of 100 public ids', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ deleted: {} }));
    const ids = Array.from({ length: 150 }, (_, n) => `3dwd-test/site/${n}`);

    await deleteUploads(ids);

    assert.equal(fetchMock.mock.callCount(), 2);
    const batches = fetchMock.mock.calls.map(({ arguments: [url, options] }) => {
      assert.equal(options.method, 'DELETE');
      return new URL(url).searchParams.getAll('public_ids[]');
    });
    assert.deepEqual(batches, [ids.slice(0, 100), ids.slice(100)]);
  });

  it('makes no call when there is nothing to delete', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));

    await deleteUploads([]);

    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
