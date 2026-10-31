// Request tests for the site owner routes (api/siteOwner/index.js): websites with post and gallery
// summaries,
// post create / read / edit / status / delete, and Sign an Upload. Covers the role guard, the ownership rule
// (another owner's or an inactive website's data is a 404), validation, the image src folder rule,
// the body order and the edit reconcile, the audit event and revalidation call after every change,
// and the upload sign rate limit. fetch is mocked in every test, so no call leaves the machine.
require('../../testing/setup');
const crypto = require('node:crypto');
const { describe, it, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../app');
const prisma = require('../../prisma');
const {
  CSRF,
  resetState,
  disconnect,
  createAdmin,
  createSiteOwner,
  createWebsite,
  paragraph,
  imageSrc,
  imageElement,
  createPost,
  createGallery,
  createOwnerWithWebsite,
  sessionCookie,
  assertNoSecrets,
  auditEvents,
  mockFetch,
  waitFor,
} = require('../../testing/helpers');

const POST_NOT_FOUND = { error: { message: 'Post not found.' } };
const WEBSITE_NOT_FOUND = { error: { message: 'Website not found.' } };
const UNKNOWN_ID = '019a0000-0000-7000-8000-000000000000';

// An image in the website's upload folder; override any field.
function image(website, overrides = {}) {
  return { src: imageSrc(website), width: 800, height: 600, altText: 'A', ...overrides };
}

let fetchMock;

beforeEach(async () => {
  await resetState();
  fetchMock = mockFetch(mock);
});
afterEach(() => mock.restoreAll());
after(disconnect);

// Sends a request as the given account. Writes carry the CSRF header.
function as(account, method, path) {
  const req = request(app)[method](path).set('Cookie', sessionCookie(account));
  return method === 'get' ? req : req.set(CSRF);
}

// The audit event a site owner's post change writes, as audit_event rows return it.
function postEvent(owner, action, postId, websiteId) {
  return {
    action,
    actorId: owner.id,
    actorEmail: owner.email,
    targetType: 'post',
    targetId: postId,
    metadata: { websiteId },
  };
}

// A valid create body for the website; override any field.
function newPost(website, overrides = {}) {
  return {
    websiteId: website.id,
    postName: 'Post',
    body: [paragraph()],
    ...overrides,
  };
}

// A valid full edit body; override any field.
function editPost(overrides = {}) {
  return {
    postName: 'Edited',
    body: [paragraph('Edited body')],
    header: null,
    subHeader: null,
    postDate: null,
    ...overrides,
  };
}

// Waits for the fire-and-forget revalidation call and returns what was sent.
async function revalidationCall() {
  await waitFor(() => assert.equal(fetchMock.mock.callCount(), 1));
  const [url, options] = fetchMock.mock.calls[0].arguments;
  return { url, options };
}

describe('site owner route guards', () => {
  const routes = [
    ['get', '/api/siteOwner/websites'],
    ['post', '/api/siteOwner/posts'],
    ['get', '/api/siteOwner/posts/some-id'],
    ['patch', '/api/siteOwner/posts/some-id'],
    ['patch', '/api/siteOwner/posts/some-id/status'],
    ['delete', '/api/siteOwner/posts/some-id'],
    ['post', '/api/siteOwner/uploads/sign'],
  ];

  for (const [method, path] of routes) {
    it(`returns 401 for ${method.toUpperCase()} ${path} without a session`, async () => {
      const res = await request(app)[method](path).set(CSRF);

      assert.equal(res.status, 401);
      assert.deepEqual(res.body, {
        error: { message: 'Your session expired, please sign in again.' },
      });
    });

    it(`returns 403 for ${method.toUpperCase()} ${path} as an administrator`, async () => {
      const admin = await createAdmin();

      const res = await as(admin, method, path);

      assert.equal(res.status, 403);
      assert.deepEqual(res.body, { error: { message: 'You do not have access to this page.' } });
    });
  }
});

describe('GET /api/siteOwner/websites', () => {
  it("returns only the owner's active websites, sorted, with post and gallery summaries newest first", async () => {
    const owner = await createSiteOwner();
    const { website: beta } = await createWebsite({ websiteName: 'Beta' });
    const { website: alpha } = await createWebsite({ websiteName: 'Alpha' });
    const { website: archived } = await createWebsite({ websiteName: 'Archived', active: false });
    for (const website of [beta, alpha, archived]) {
      await prisma.accountWebsite.create({ data: { accountId: owner.id, websiteId: website.id } });
    }
    await createOwnerWithWebsite({ websiteName: 'Not Mine' });
    const older = await createPost(alpha, { postName: 'Older', status: 'draft' });
    const newer = await createPost(alpha, {
      postName: 'Newer',
      postDate: new Date('2026-10-01T00:00:00.000Z'),
    });
    const olderGallery = await createGallery(alpha, {
      galleryName: 'Interior',
      slug: 'interior',
      status: 'draft',
    });
    const newerGallery = await createGallery(alpha, { galleryName: 'Art', slug: 'art' });
    await createGallery(alpha, { galleryName: 'Deleted', deletedAt: new Date() });

    const res = await as(owner, 'get', '/api/siteOwner/websites');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: [
        {
          id: alpha.id,
          websiteName: 'Alpha',
          url: alpha.url,
          active: true,
          posts: [
            {
              id: newer.id,
              postName: 'Newer',
              postDate: '2026-10-01',
              active: true,
              status: 'published',
              createdAt: newer.createdAt.toISOString(),
            },
            {
              id: older.id,
              postName: 'Older',
              postDate: null,
              active: false,
              status: 'draft',
              createdAt: older.createdAt.toISOString(),
            },
          ],
          galleries: [
            {
              id: newerGallery.id,
              galleryName: 'Art',
              slug: 'art',
              status: 'published',
              createdAt: newerGallery.createdAt.toISOString(),
            },
            {
              id: olderGallery.id,
              galleryName: 'Interior',
              slug: 'interior',
              status: 'draft',
              createdAt: olderGallery.createdAt.toISOString(),
            },
          ],
        },
        {
          id: beta.id,
          websiteName: 'Beta',
          url: beta.url,
          active: true,
          posts: [],
          galleries: [],
        },
      ],
    });
    await assertNoSecrets(res.body);
  });
});

describe('POST /api/siteOwner/posts', () => {
  it('records the new post in the audit log, without its content', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { body: [paragraph('Private draft words')] }),
    );

    const events = await auditEvents();
    assert.deepEqual(events, [postEvent(owner, 'post.created', res.body.data.id, website.id)]);
    assert.ok(!JSON.stringify(events).includes('Private draft words'));
  });

  it('creates a post with its body in order, markup kept as typed, and returns the Post shape', async () => {
    const { owner, website } = await createOwnerWithWebsite({ websiteName: 'Stevie The Dog' });
    const second = image(website, { src: imageSrc(website, 'b'), altText: 'B' });

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, {
        postName: ' First Post ',
        header: 'Hello',
        subHeader: 'World',
        postDate: '2026-10-07',
        body: [
          imageElement(image(website)),
          paragraph(' First paragraph.\nSecond line. '),
          imageElement(second),
          paragraph('**Bold** and *italic* and [a link](https://example.com).'),
        ],
      }),
    );

    assert.equal(res.status, 201);
    const post = res.body.data;
    assert.deepEqual(Object.keys(post).sort(), [
      'active',
      'body',
      'createdAt',
      'header',
      'id',
      'postDate',
      'postName',
      'status',
      'subHeader',
      'updatedAt',
      'websiteId',
      'websiteName',
    ]);
    assert.equal(post.websiteId, website.id);
    assert.equal(post.websiteName, 'Stevie The Dog');
    assert.equal(post.postName, 'First Post');
    assert.equal(post.header, 'Hello');
    assert.equal(post.subHeader, 'World');
    assert.equal(post.postDate, '2026-10-07');
    assert.equal(post.active, true);
    assert.equal(post.status, 'published');
    const storedImages = await prisma.image.findMany({ where: { postId: post.id } });
    const imageId = (src) => storedImages.find((image) => image.src === src).id;
    assert.deepEqual(post.body, [
      { type: 'image', image: { id: imageId(image(website).src), ...image(website) } },
      { type: 'paragraph', text: 'First paragraph.\nSecond line.' },
      { type: 'image', image: { id: imageId(second.src), ...second } },
      { type: 'paragraph', text: '**Bold** and *italic* and [a link](https://example.com).' },
    ]);
    await assertNoSecrets(res.body);
    await revalidationCall();
  });

  it('stores and returns blank optional fields as null', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { header: '   ', subHeader: '', postDate: null }),
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.header, null);
    assert.equal(res.body.data.subHeader, null);
    assert.equal(res.body.data.postDate, null);
    const stored = await prisma.post.findUnique({ where: { id: res.body.data.id } });
    assert.equal(stored.header, null);
    assert.equal(stored.subHeader, null);
    assert.equal(stored.postDate, null);
    await revalidationCall();
  });

  it('creates a draft when status is draft, with active false', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { status: 'draft' }),
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'draft');
    assert.equal(res.body.data.active, false);
    const stored = await prisma.post.findUnique({ where: { id: res.body.data.id } });
    assert.equal(stored.status, 'draft');
    assert.equal(stored.active, false);
    await revalidationCall();
  });

  it('creates a draft when the legacy active is false', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { active: false }),
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'draft');
    assert.equal(res.body.data.active, false);
    await revalidationCall();
  });

  it("returns 400 when status and active don't match, and saves nothing", async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { status: 'draft', active: true }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: { status: "Status and active don't match." },
      },
    });
    assert.equal(await prisma.post.count(), 0);
  });

  it('calls the website revalidation webhook with its secret after creating', async () => {
    const { owner, website, webhookSecret } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(newPost(website));

    const { url, options } = await revalidationCall();
    assert.equal(url, `${website.url}/api/revalidate`);
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, {
      Authorization: `Bearer ${webhookSecret}`,
      'Content-Type': 'application/json',
    });
    assert.deepEqual(JSON.parse(options.body), { websiteId: website.id, postId: res.body.data.id });
  });

  it('still returns 201 when the revalidation call fails', async (t) => {
    const { owner, website } = await createOwnerWithWebsite();
    mock.restoreAll();
    fetchMock = mockFetch(mock, new TypeError('fetch failed'));
    const errorLog = t.mock.method(console, 'error', () => {});

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(newPost(website));

    assert.equal(res.status, 201);
    assert.equal(await prisma.post.count(), 1);
    await waitFor(() => assert.equal(errorLog.mock.callCount(), 1));
  });

  it('responds without waiting for a revalidation call that never finishes', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    mock.restoreAll();
    fetchMock = mockFetch(mock, 'hang');

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(newPost(website));

    assert.equal(res.status, 201);
    await revalidationCall();
  });

  it('ignores an accountId in the body and checks the session account', async () => {
    const owner = await createSiteOwner();
    const { owner: other, website: otherWebsite } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(otherWebsite, { accountId: other.id }),
    );

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, WEBSITE_NOT_FOUND);
    assert.equal(await prisma.post.count(), 0);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('returns 404 for an inactive website', async () => {
    const { owner, website } = await createOwnerWithWebsite({ active: false });

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(newPost(website));

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, WEBSITE_NOT_FOUND);
  });

  it("returns 400 and saves nothing for an image in another website's folder", async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const { website: otherWebsite } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, {
        body: [paragraph(), imageElement(image(website, { src: imageSrc(otherWebsite) }))],
      }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: { message: 'Invalid image.' } });
    assert.equal(await prisma.post.count(), 0);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('returns 400 with fields keyed by the full path to each bad input', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, {
        postName: '',
        body: [
          paragraph('[menu](http://example.com)'),
          imageElement(image(website, { src: 'http://insecure.example.com/a.jpg' })),
        ],
      }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: {
          postName: 'Post name is required.',
          'body.0.text': 'Each link must be a valid URL starting with https://',
          'body.1.image.src': 'Must be a valid URL starting with https://',
        },
      },
    });
    assert.equal(await prisma.post.count(), 0);
  });

  it('returns 400 for a body without a paragraph and saves nothing', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { body: [imageElement(image(website))] }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, { body: 'Add at least one paragraph.' });
    assert.equal(await prisma.post.count(), 0);
    assert.equal(await prisma.image.count(), 0);
  });
});

describe('GET /api/siteOwner/posts/:id', () => {
  it('returns the post with its website name and body in order', async () => {
    const { owner, website } = await createOwnerWithWebsite({ websiteName: 'Stevie The Dog' });
    const post = await createPost(website, {
      header: 'Hello',
      body: [paragraph('Intro'), imageElement(image(website)), paragraph('Outro')],
    });
    const { postId, ...stored } = post.images[0];

    const res = await as(owner, 'get', `/api/siteOwner/posts/${post.id}`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: {
        id: post.id,
        websiteId: website.id,
        websiteName: 'Stevie The Dog',
        postName: 'Post',
        header: 'Hello',
        subHeader: null,
        postDate: null,
        active: true,
        status: 'published',
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
        body: [
          { type: 'paragraph', text: 'Intro' },
          { type: 'image', image: stored },
          { type: 'paragraph', text: 'Outro' },
        ],
      },
    });
  });

  it("returns 404 for another site owner's post", async () => {
    const { owner } = await createOwnerWithWebsite();
    const { website: otherWebsite } = await createOwnerWithWebsite();
    const post = await createPost(otherWebsite);

    const res = await as(owner, 'get', `/api/siteOwner/posts/${post.id}`);

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, POST_NOT_FOUND);
  });

  it("returns 404 for a post on the owner's inactive website", async () => {
    const { owner, website } = await createOwnerWithWebsite({ active: false });
    const post = await createPost(website);

    const res = await as(owner, 'get', `/api/siteOwner/posts/${post.id}`);

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, POST_NOT_FOUND);
  });

  it('returns 404 for an unknown post id', async () => {
    const { owner } = await createOwnerWithWebsite();

    const res = await as(owner, 'get', `/api/siteOwner/posts/${UNKNOWN_ID}`);

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, POST_NOT_FOUND);
  });
});

describe('PATCH /api/siteOwner/posts/:id', () => {
  it('records the edit in the audit log', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(editPost());

    assert.deepEqual(await auditEvents(), [postEvent(owner, 'post.updated', post.id, website.id)]);
  });

  it('updates kept images, inserts new ones and deletes the missing ones', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, {
      body: [
        paragraph(),
        imageElement(image(website)),
        imageElement(image(website, { altText: 'Removed' })),
      ],
    });
    const [keptImage, removedImage] = post.images;

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({
        header: 'New header',
        postDate: '2026-10-07',
        body: [
          paragraph('Edited body'),
          imageElement({ id: keptImage.id, ...image(website, { altText: 'Updated' }) }),
          imageElement(image(website, { altText: 'Added' })),
        ],
      }),
    );

    assert.equal(res.status, 200);
    const edited = res.body.data;
    assert.equal(edited.postName, 'Edited');
    assert.equal(edited.header, 'New header');
    assert.equal(edited.postDate, '2026-10-07');
    assert.deepEqual(
      edited.body.map((element) =>
        element.type === 'paragraph'
          ? element.text
          : [element.image.id === keptImage.id, element.image.altText],
      ),
      ['Edited body', [true, 'Updated'], [false, 'Added']],
    );
    assert.equal(await prisma.image.findUnique({ where: { id: removedImage.id } }), null);
    assert.ok(new Date(edited.updatedAt) > post.updatedAt);
    await revalidationCall();
  });

  it('reorders the body, keeping image ids and leaving no stale elements', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, {
      body: [paragraph('One'), paragraph('Two'), imageElement(image(website))],
    });
    const imageId = post.images[0].id;

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({ body: [imageElement({ id: imageId, ...image(website) }), paragraph('Two')] }),
    );

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.body, [
      { type: 'image', image: { id: imageId, ...image(website) } },
      { type: 'paragraph', text: 'Two' },
    ]);
    const stored = await prisma.element.findMany({
      where: { postId: post.id },
      orderBy: { position: 'asc' },
      select: { position: true, type: true, text: true, imageId: true },
    });
    assert.deepEqual(stored, [
      { position: 0, type: 'image', text: null, imageId },
      { position: 1, type: 'paragraph', text: 'Two', imageId: null },
    ]);
    await revalidationCall();
  });

  it('clears optional fields sent as null', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, {
      header: 'Header',
      subHeader: 'Sub',
      postDate: new Date('2026-10-01T00:00:00.000Z'),
    });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(editPost());

    assert.equal(res.status, 200);
    assert.equal(res.body.data.header, null);
    assert.equal(res.body.data.subHeader, null);
    assert.equal(res.body.data.postDate, null);
    await revalidationCall();
  });

  it('ignores websiteId, status and active in the body', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const { website: otherOwnWebsite } = await createWebsite();
    await prisma.accountWebsite.create({
      data: { accountId: owner.id, websiteId: otherOwnWebsite.id },
    });
    const post = await createPost(website);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({ websiteId: otherOwnWebsite.id, status: 'draft', active: false }),
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.websiteId, website.id);
    assert.equal(res.body.data.status, 'published');
    assert.equal(res.body.data.active, true);
    await revalidationCall();
  });

  it('calls the revalidation webhook for the post after editing', async () => {
    const { owner, website, webhookSecret } = await createOwnerWithWebsite();
    const post = await createPost(website);

    await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(editPost());

    const { url, options } = await revalidationCall();
    assert.equal(url, `${website.url}/api/revalidate`);
    assert.equal(options.headers.Authorization, `Bearer ${webhookSecret}`);
    assert.deepEqual(JSON.parse(options.body), { websiteId: website.id, postId: post.id });
  });

  it("returns 400 and changes nothing for another post's image id", async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { postName: 'Original' });
    const otherPost = await createPost(website, {
      body: [paragraph(), imageElement(image(website))],
    });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({
        body: [paragraph(), imageElement({ id: otherPost.images[0].id, ...image(website) })],
      }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: { message: 'Invalid image.' } });
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.postName, 'Original');
    assert.equal(await prisma.image.count({ where: { postId: otherPost.id } }), 1);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('returns 400 for an image id sent twice', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { body: [paragraph(), imageElement(image(website))] });
    const stored = { id: post.images[0].id, ...image(website) };

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({ body: [paragraph(), imageElement(stored), imageElement(stored)] }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: { message: 'Invalid image.' } });
  });

  it('returns 400 and changes nothing when an image is outside the website folder', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { body: [paragraph(), imageElement(image(website))] });
    const outside = 'https://res.cloudinary.com/test-cloud/image/upload/v1/elsewhere/a.jpg';

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({
        body: [
          paragraph(),
          imageElement({ id: post.images[0].id, ...image(website) }),
          imageElement(image(website, { src: outside })),
        ],
      }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: { message: 'Invalid image.' } });
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.postName, 'Post');
    assert.equal(await prisma.image.count(), 1);
  });

  it('returns 400 with fields for an invalid edit', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({ body: [paragraph(' ')], postDate: '2026-02-30' }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, {
      'body.0.text': 'Paragraph is required.',
      postDate: 'Enter a valid date (YYYY-MM-DD).',
    });
  });

  it("returns 404 for another site owner's post", async () => {
    const { owner } = await createOwnerWithWebsite();
    const { website: otherWebsite } = await createOwnerWithWebsite();
    const post = await createPost(otherWebsite, { postName: 'Theirs' });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(editPost());

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, POST_NOT_FOUND);
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.postName, 'Theirs');
  });
});

describe('PATCH /api/siteOwner/posts/:id/status', () => {
  it('records drafting and publishing in the audit log, for status and the legacy active', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);
    const path = `/api/siteOwner/posts/${post.id}/status`;

    await as(owner, 'patch', path).send({ status: 'draft' });
    await as(owner, 'patch', path).send({ status: 'published' });
    await as(owner, 'patch', path).send({ active: false });
    await as(owner, 'patch', path).send({ active: true });

    assert.deepEqual(await auditEvents(), [
      postEvent(owner, 'post.drafted', post.id, website.id),
      postEvent(owner, 'post.published', post.id, website.id),
      postEvent(owner, 'post.drafted', post.id, website.id),
      postEvent(owner, 'post.published', post.id, website.id),
    ]);
  });

  it('sets a post to draft, with active false, and returns the Post shape', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      status: 'draft',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, post.id);
    assert.equal(res.body.data.status, 'draft');
    assert.equal(res.body.data.active, false);
    assert.equal(res.body.data.websiteName, website.websiteName);
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.status, 'draft');
    assert.equal(stored.active, false);
    await revalidationCall();
  });

  it('publishes a draft, with active true', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { status: 'draft' });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      status: 'published',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'published');
    assert.equal(res.body.data.active, true);
    await revalidationCall();
  });

  it('sets a post to draft from the legacy { active: false }', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      active: false,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'draft');
    assert.equal(res.body.data.active, false);
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.status, 'draft');
    await revalidationCall();
  });

  it("returns 400 when status and active don't match, and leaves the post unchanged", async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      status: 'draft',
      active: true,
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, { status: "Status and active don't match." });
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.status, 'published');
    assert.deepEqual(await auditEvents(), []);
  });

  it('returns 400 on status when neither status nor active is sent', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({});

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, { status: 'Status must be draft or published.' });
  });

  it('calls the revalidation webhook for the post after a status change', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({ status: 'draft' });

    const { url, options } = await revalidationCall();
    assert.equal(url, `${website.url}/api/revalidate`);
    assert.deepEqual(JSON.parse(options.body), { websiteId: website.id, postId: post.id });
  });

  it('returns 400 when active is not a boolean', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      active: 'false',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: { active: 'Active must be true or false.' },
      },
    });
  });

  it("returns 404 for another site owner's post and leaves it unchanged", async () => {
    const { owner } = await createOwnerWithWebsite();
    const { website: otherWebsite } = await createOwnerWithWebsite();
    const post = await createPost(otherWebsite);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      status: 'draft',
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, POST_NOT_FOUND);
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.status, 'published');
  });
});

describe('DELETE /api/siteOwner/posts/:id', () => {
  it('stamps deletedAt, returns 204 with no body and records post.deleted', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    const res = await as(owner, 'delete', `/api/siteOwner/posts/${post.id}`);

    assert.equal(res.status, 204);
    assert.equal(res.text, '');
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.ok(stored.deletedAt instanceof Date);
    assert.deepEqual(await auditEvents(), [postEvent(owner, 'post.deleted', post.id, website.id)]);
  });

  it('calls the revalidation webhook for the post after a delete', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    await as(owner, 'delete', `/api/siteOwner/posts/${post.id}`);

    const { url, options } = await revalidationCall();
    assert.equal(url, `${website.url}/api/revalidate`);
    assert.deepEqual(JSON.parse(options.body), { websiteId: website.id, postId: post.id });
  });

  it('returns 404 on every post route once a post is deleted', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);
    const path = `/api/siteOwner/posts/${post.id}`;
    await as(owner, 'delete', path);

    const responses = [
      await as(owner, 'get', path),
      await as(owner, 'patch', path).send(editPost()),
      await as(owner, 'patch', `${path}/status`).send({ status: 'draft' }),
      await as(owner, 'delete', path),
    ];

    for (const res of responses) {
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, POST_NOT_FOUND);
    }
  });

  it("leaves a deleted post out of the website's post summaries", async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const kept = await createPost(website, { postName: 'Kept' });
    const deleted = await createPost(website, { postName: 'Deleted' });
    await as(owner, 'delete', `/api/siteOwner/posts/${deleted.id}`);

    const res = await as(owner, 'get', '/api/siteOwner/websites');

    assert.deepEqual(
      res.body.data[0].posts.map((post) => post.id),
      [kept.id],
    );
  });

  it("returns 404 for another site owner's post and leaves it undeleted", async () => {
    const { owner } = await createOwnerWithWebsite();
    const { website: otherWebsite } = await createOwnerWithWebsite();
    const post = await createPost(otherWebsite);

    const res = await as(owner, 'delete', `/api/siteOwner/posts/${post.id}`);

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, POST_NOT_FOUND);
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.deletedAt, null);
  });

  it('returns 403 without the CSRF header and leaves the post undeleted', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    const res = await request(app)
      .delete(`/api/siteOwner/posts/${post.id}`)
      .set('Cookie', sessionCookie(owner));

    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: { message: 'Request blocked.' } });
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.deletedAt, null);
  });
});

describe('POST /api/siteOwner/uploads/sign', () => {
  it('returns 429 for the eleventh sign from one account within 15 minutes, per account', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const other = await createOwnerWithWebsite();
    const sign = (account, websiteId) =>
      as(account, 'post', '/api/siteOwner/uploads/sign').send({ websiteId });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal((await sign(owner, website.id)).status, 200);
    }

    const res = await sign(owner, website.id);

    assert.equal(res.status, 429);
    assert.deepEqual(res.body, {
      error: { message: 'Too many requests. Please try again later.' },
    });
    assert.equal((await sign(other.owner, other.website.id)).status, 200);
  });

  it("returns a signed upload for the website's folder, built only by the backend", async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const before = Math.floor(Date.now() / 1000);

    const res = await as(owner, 'post', '/api/siteOwner/uploads/sign').send({
      websiteId: website.id,
      folder: 'someone-else',
      transformation: 'c_scale,w_10000',
    });

    assert.equal(res.status, 200);
    const { uploadUrl, fields } = res.body.data;
    assert.equal(uploadUrl, 'https://api.cloudinary.com/v1_1/test-cloud/image/upload');
    const { signature, api_key: apiKey, ...signed } = fields;
    assert.deepEqual(signed, {
      allowed_formats: 'jpg,jpeg,png,webp',
      folder: `3dwd-test/${website.mediaFolder}`,
      timestamp: signed.timestamp,
      transformation: 'c_limit,w_2500,h_2500',
    });
    assert.ok(signed.timestamp >= before && signed.timestamp <= Math.floor(Date.now() / 1000));
    assert.equal(apiKey, 'test-cloudinary-key');
    const toSign = Object.keys(signed)
      .sort()
      .map((key) => `${key}=${signed[key]}`)
      .join('&');
    const expected = crypto
      .createHash('sha1')
      .update(`${toSign}test-cloudinary-secret`)
      .digest('hex');
    assert.equal(signature, expected);
    assert.ok(!JSON.stringify(res.body).includes('test-cloudinary-secret'));
    await assertNoSecrets(res.body);
  });

  it('returns 400 with fields when websiteId is missing', async () => {
    const { owner } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/uploads/sign').send({ websiteId: ' ' });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: { websiteId: 'Website is required.' },
      },
    });
  });

  it("returns 404 for another site owner's website", async () => {
    const { owner } = await createOwnerWithWebsite();
    const { website: otherWebsite } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/uploads/sign').send({
      websiteId: otherWebsite.id,
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, WEBSITE_NOT_FOUND);
  });

  it("returns 404 for the owner's inactive website", async () => {
    const { owner, website } = await createOwnerWithWebsite({ active: false });

    const res = await as(owner, 'post', '/api/siteOwner/uploads/sign').send({
      websiteId: website.id,
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, WEBSITE_NOT_FOUND);
  });

  it('returns 404 for an unknown website id', async () => {
    const { owner } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/uploads/sign').send({
      websiteId: UNKNOWN_ID,
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, WEBSITE_NOT_FOUND);
  });
});
