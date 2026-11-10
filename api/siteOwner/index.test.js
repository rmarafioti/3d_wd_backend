// Request tests for the site owner routes (api/siteOwner/index.js).
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
  createAbility,
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
const DAY_MS = 24 * 60 * 60 * 1000;

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
    ['patch', '/api/siteOwner/posts/some-id/publishAt'],
    ['delete', '/api/siteOwner/posts/some-id'],
    ['get', '/api/siteOwner/posts/deleted'],
    ['post', '/api/siteOwner/posts/some-id/restore'],
    ['post', '/api/siteOwner/uploads/sign'],
    ['get', '/api/siteOwner/notifications'],
    ['get', '/api/siteOwner/notifications/unreadCount'],
    ['post', '/api/siteOwner/notifications/some-id/read'],
    ['post', '/api/siteOwner/threads'],
    ['get', '/api/siteOwner/threads'],
    ['get', '/api/siteOwner/threads/some-id'],
    ['post', '/api/siteOwner/threads/some-id/messages'],
    ['post', '/api/siteOwner/threads/some-id/read'],
    ['get', '/api/siteOwner/deleted'],
    ['post', '/api/siteOwner/deleted'],
    ['post', '/api/siteOwner/deleted/restore'],
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
  it("returns only the owner's active websites, sorted, with abilities and post and gallery summaries", async () => {
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
    const newerGallery = await createGallery(alpha, {
      galleryName: 'Art',
      slug: 'art',
      requestedAt: new Date('2026-11-02T00:00:00.000Z'),
      placement: 'requested',
    });
    await createGallery(alpha, { galleryName: 'Deleted', deletedAt: new Date() });
    const postsAbility = await createAbility(alpha, 'posts', {
      status: 'live',
      placement: 'live',
      requestNote: 'The News page',
      requestedAt: new Date('2026-11-01T00:00:00.000Z'),
    });
    const galleriesAbility = await createAbility(alpha, 'galleries');
    await createAbility(beta, 'galleries', { removedAt: new Date() });

    const res = await as(owner, 'get', '/api/siteOwner/websites');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: [
        {
          id: alpha.id,
          websiteName: 'Alpha',
          url: alpha.url,
          active: true,
          abilities: [
            {
              id: postsAbility.id,
              kind: 'posts',
              status: 'live',
              turnedOn: true,
              placement: 'live',
              requestNote: 'The News page',
              requestedAt: '2026-11-01T00:00:00.000Z',
              createdAt: postsAbility.createdAt.toISOString(),
              updatedAt: postsAbility.updatedAt.toISOString(),
            },
            {
              id: galleriesAbility.id,
              kind: 'galleries',
              status: 'added',
              turnedOn: true,
              placement: null,
              requestNote: null,
              requestedAt: null,
              createdAt: galleriesAbility.createdAt.toISOString(),
              updatedAt: galleriesAbility.updatedAt.toISOString(),
            },
          ],
          posts: [
            {
              id: newer.id,
              postName: 'Newer',
              postDate: '2026-10-01',
              status: 'published',
              publishAt: null,
              publishedAt: null,
              createdAt: newer.createdAt.toISOString(),
            },
            {
              id: older.id,
              postName: 'Older',
              postDate: null,
              status: 'draft',
              publishAt: null,
              publishedAt: null,
              createdAt: older.createdAt.toISOString(),
            },
          ],
          galleries: [
            {
              id: newerGallery.id,
              galleryName: 'Art',
              slug: 'art',
              status: 'published',
              placement: 'requested',
              requestedAt: '2026-11-02T00:00:00.000Z',
              publishAt: null,
              publishedAt: null,
              createdAt: newerGallery.createdAt.toISOString(),
            },
            {
              id: olderGallery.id,
              galleryName: 'Interior',
              slug: 'interior',
              status: 'draft',
              placement: null,
              requestedAt: null,
              publishAt: null,
              publishedAt: null,
              createdAt: olderGallery.createdAt.toISOString(),
            },
          ],
        },
        {
          id: beta.id,
          websiteName: 'Beta',
          url: beta.url,
          active: true,
          abilities: [],
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
      'body',
      'createdAt',
      'header',
      'id',
      'postDate',
      'postName',
      'publishAt',
      'publishedAt',
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

  it('creates a draft when status is draft', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { status: 'draft' }),
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'draft');
    const stored = await prisma.post.findUnique({ where: { id: res.body.data.id } });
    assert.equal(stored.status, 'draft');
    await revalidationCall();
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
        status: 'published',
        publishAt: null,
        publishedAt: null,
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
      editPost({ websiteId: otherOwnWebsite.id, status: 'draft' }),
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.websiteId, website.id);
    assert.equal(res.body.data.status, 'published');
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
  it('records drafting and publishing in the audit log', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);
    const path = `/api/siteOwner/posts/${post.id}/status`;

    await as(owner, 'patch', path).send({ status: 'draft' });
    await as(owner, 'patch', path).send({ status: 'published' });

    assert.deepEqual(await auditEvents(), [
      postEvent(owner, 'post.drafted', post.id, website.id),
      postEvent(owner, 'post.published', post.id, website.id),
    ]);
  });

  it('sets a post to draft and returns the Post shape', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      status: 'draft',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, post.id);
    assert.equal(res.body.data.status, 'draft');
    assert.equal(res.body.data.websiteName, website.websiteName);
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.status, 'draft');
    await revalidationCall();
  });

  it('publishes a draft', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { status: 'draft' });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      status: 'published',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'published');
    await revalidationCall();
  });

  it('returns 400 on status when status is missing, and leaves the post unchanged', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({});

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: { status: 'Status must be draft or published.' },
      },
    });
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.status, 'published');
  });

  it('calls the revalidation webhook for the post after a status change', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({ status: 'draft' });

    const { url, options } = await revalidationCall();
    assert.equal(url, `${website.url}/api/revalidate`);
    assert.deepEqual(JSON.parse(options.body), { websiteId: website.id, postId: post.id });
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

  it("keeps a requested or live posts placement when the website's last post is deleted", async () => {
    for (const placement of ['requested', 'live']) {
      const { owner, website } = await createOwnerWithWebsite();
      const requestedAt = new Date();
      const ability = await createAbility(website, 'posts', {
        placement,
        requestNote: 'Under the menu',
        requestedAt,
      });
      const post = await createPost(website);

      await as(owner, 'delete', `/api/siteOwner/posts/${post.id}`);

      const stored = await prisma.websiteAbility.findUnique({ where: { id: ability.id } });
      assert.equal(stored.placement, placement);
      assert.equal(stored.requestNote, 'Under the menu');
      assert.deepEqual(stored.requestedAt, requestedAt);
      assert.equal((await auditEvents()).at(-1).action, 'post.deleted');
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

// A post deleted the given number of days ago.
function createDeletedPost(website, daysAgo, overrides = {}) {
  return createPost(website, { deletedAt: new Date(Date.now() - daysAgo * DAY_MS), ...overrides });
}

describe('GET /api/siteOwner/posts/deleted', () => {
  it("lists the account's posts deleted in the last 30 days, newest deletion first", async () => {
    const { owner, website } = await createOwnerWithWebsite({ websiteName: 'Alpha' });
    const older = await createDeletedPost(website, 10, {
      postName: 'Older',
      postDate: new Date('2026-10-01'),
      status: 'draft',
    });
    const newer = await createDeletedPost(website, 1, { postName: 'Newer' });

    const res = await as(owner, 'get', '/api/siteOwner/posts/deleted');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: [
        {
          id: newer.id,
          websiteId: website.id,
          websiteName: 'Alpha',
          postName: 'Newer',
          postDate: null,
          status: 'published',
          deletedAt: newer.deletedAt.toISOString(),
          restorableUntil: new Date(newer.deletedAt.getTime() + 30 * DAY_MS).toISOString(),
        },
        {
          id: older.id,
          websiteId: website.id,
          websiteName: 'Alpha',
          postName: 'Older',
          postDate: '2026-10-01',
          status: 'draft',
          deletedAt: older.deletedAt.toISOString(),
          restorableUntil: new Date(older.deletedAt.getTime() + 30 * DAY_MS).toISOString(),
        },
      ],
      nextCursor: null,
    });
    await assertNoSecrets(res.body);
  });

  it('covers every active website linked to the account', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const { website: second } = await createWebsite();
    await prisma.accountWebsite.create({ data: { accountId: owner.id, websiteId: second.id } });
    const first = await createDeletedPost(website, 2);
    const other = await createDeletedPost(second, 1);

    const res = await as(owner, 'get', '/api/siteOwner/posts/deleted');

    assert.deepEqual(
      res.body.data.map((post) => post.id),
      [other.id, first.id],
    );
  });

  it('leaves out kept posts, posts deleted over 30 days ago, other owners and inactive websites', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const { website: inactive } = await createWebsite({ active: false });
    await prisma.accountWebsite.create({ data: { accountId: owner.id, websiteId: inactive.id } });
    const { website: otherWebsite } = await createOwnerWithWebsite();
    const listed = await createDeletedPost(website, 29);
    await createPost(website);
    await createDeletedPost(website, 31);
    await createDeletedPost(inactive, 1);
    await createDeletedPost(otherWebsite, 1);

    const res = await as(owner, 'get', '/api/siteOwner/posts/deleted');

    assert.deepEqual(
      res.body.data.map((post) => post.id),
      [listed.id],
    );
  });

  it('pages with limit and cursor, and nextCursor is null on the last page', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const third = await createDeletedPost(website, 3);
    const second = await createDeletedPost(website, 2);
    const first = await createDeletedPost(website, 1);

    const page1 = await as(owner, 'get', '/api/siteOwner/posts/deleted?limit=2');
    const page2 = await as(
      owner,
      'get',
      `/api/siteOwner/posts/deleted?limit=2&cursor=${page1.body.nextCursor}`,
    );

    assert.deepEqual(
      page1.body.data.map((post) => post.id),
      [first.id, second.id],
    );
    assert.equal(page1.body.nextCursor, second.id);
    assert.deepEqual(
      page2.body.data.map((post) => post.id),
      [third.id],
    );
    assert.equal(page2.body.nextCursor, null);
  });

  it('ends the list early when the post the cursor names was restored', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    await createDeletedPost(website, 2);
    const first = await createDeletedPost(website, 1);
    await as(owner, 'post', `/api/siteOwner/posts/${first.id}/restore`);

    const res = await as(owner, 'get', `/api/siteOwner/posts/deleted?cursor=${first.id}`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: [], nextCursor: null });
  });

  it('returns an empty list when nothing was deleted', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    await createPost(website);

    const res = await as(owner, 'get', '/api/siteOwner/posts/deleted');

    assert.deepEqual(res.body, { data: [], nextCursor: null });
  });

  it('returns 400 with fields for a bad limit or cursor', async () => {
    const { owner } = await createOwnerWithWebsite();

    const res = await as(owner, 'get', '/api/siteOwner/posts/deleted?limit=0&cursor=nope');

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: {
          limit: 'Limit must be a whole number from 1 to 100.',
          cursor: 'Invalid cursor.',
        },
      },
    });
  });
});

describe('POST /api/siteOwner/posts/:id/restore', () => {
  it('clears deletedAt and returns the post with its body, images and status', async () => {
    const { owner, website } = await createOwnerWithWebsite({ websiteName: 'Alpha' });
    const photo = image(website);
    const post = await createDeletedPost(website, 5, {
      status: 'draft',
      body: [paragraph('Hello'), imageElement(photo)],
    });

    const res = await as(owner, 'post', `/api/siteOwner/posts/${post.id}/restore`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, post.id);
    assert.equal(res.body.data.status, 'draft');
    assert.equal(res.body.data.websiteName, 'Alpha');
    assert.deepEqual(res.body.data.body, [
      { type: 'paragraph', text: 'Hello' },
      { type: 'image', image: { id: post.images[0].id, ...photo } },
    ]);
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.deletedAt, null);
    await assertNoSecrets(res.body);
  });

  it('records post.restored', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createDeletedPost(website, 1);

    await as(owner, 'post', `/api/siteOwner/posts/${post.id}/restore`);

    assert.deepEqual(await auditEvents(), [postEvent(owner, 'post.restored', post.id, website.id)]);
  });

  it('calls the revalidation webhook for the post after a restore', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createDeletedPost(website, 1);

    await as(owner, 'post', `/api/siteOwner/posts/${post.id}/restore`);

    const { url, options } = await revalidationCall();
    assert.equal(url, `${website.url}/api/revalidate`);
    assert.deepEqual(JSON.parse(options.body), { websiteId: website.id, postId: post.id });
  });

  it('brings a deleted post back to every post route and out of the deleted list', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);
    await as(owner, 'delete', `/api/siteOwner/posts/${post.id}`);

    await as(owner, 'post', `/api/siteOwner/posts/${post.id}/restore`);

    const websites = await as(owner, 'get', '/api/siteOwner/websites');
    const single = await as(owner, 'get', `/api/siteOwner/posts/${post.id}`);
    const deleted = await as(owner, 'get', '/api/siteOwner/posts/deleted');
    assert.deepEqual(
      websites.body.data[0].posts.map((item) => item.id),
      [post.id],
    );
    assert.equal(single.status, 200);
    assert.deepEqual(deleted.body.data, []);
  });

  it('keeps the posts placement through a delete and restore of the last post', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts', {
      placement: 'requested',
      requestNote: 'Under the menu',
      requestedAt: new Date(),
    });
    const post = await createPost(website);
    await as(owner, 'delete', `/api/siteOwner/posts/${post.id}`);

    await as(owner, 'post', `/api/siteOwner/posts/${post.id}/restore`);

    const stored = await prisma.websiteAbility.findUnique({ where: { id: ability.id } });
    assert.equal(stored.placement, 'requested');
    assert.equal(stored.requestNote, 'Under the menu');
  });

  it('returns 404 for a post that is not deleted, deleted over 30 days ago, or unknown', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const kept = await createPost(website);
    const expired = await createDeletedPost(website, 31);

    const responses = [
      await as(owner, 'post', `/api/siteOwner/posts/${kept.id}/restore`),
      await as(owner, 'post', `/api/siteOwner/posts/${expired.id}/restore`),
      await as(owner, 'post', `/api/siteOwner/posts/${UNKNOWN_ID}/restore`),
    ];

    for (const res of responses) {
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, POST_NOT_FOUND);
    }
    const stored = await prisma.post.findUnique({ where: { id: expired.id } });
    assert.ok(stored.deletedAt instanceof Date);
    assert.deepEqual(await auditEvents(), []);
  });

  it("returns 404 for another site owner's post and leaves it deleted", async () => {
    const { owner } = await createOwnerWithWebsite();
    const { website: otherWebsite } = await createOwnerWithWebsite();
    const post = await createDeletedPost(otherWebsite, 1);

    const res = await as(owner, 'post', `/api/siteOwner/posts/${post.id}/restore`);

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, POST_NOT_FOUND);
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.ok(stored.deletedAt instanceof Date);
  });

  it('returns 404 for a post on an inactive website', async () => {
    const { owner, website } = await createOwnerWithWebsite({ active: false });
    const post = await createDeletedPost(website, 1);

    const res = await as(owner, 'post', `/api/siteOwner/posts/${post.id}/restore`);

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, POST_NOT_FOUND);
  });

  it('returns 403 without the CSRF header and leaves the post deleted', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createDeletedPost(website, 1);

    const res = await request(app)
      .post(`/api/siteOwner/posts/${post.id}/restore`)
      .set('Cookie', sessionCookie(owner));

    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: { message: 'Request blocked.' } });
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.ok(stored.deletedAt instanceof Date);
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

describe('post go-live date (publishAt)', () => {
  const inADay = () => new Date(Date.now() + DAY_MS);
  const publishAtError = (message) => ({
    error: { message: 'Please fix the highlighted fields.', fields: { publishAt: message } },
  });

  it('creates a draft with a go-live date and returns it on the Post and its summary', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const publishAt = inADay();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { status: 'draft', publishAt: publishAt.toISOString() }),
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.publishAt, publishAt.toISOString());
    const websites = await as(owner, 'get', '/api/siteOwner/websites');
    assert.equal(websites.body.data[0].posts[0].publishAt, publishAt.toISOString());
  });

  it('returns 400 for a go-live date on a published post, the default status', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { publishAt: inADay().toISOString() }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, publishAtError('Only a draft can have a go-live date.'));
    assert.equal(await prisma.post.count(), 0);
  });

  it('returns 400 for a go-live date that has passed or is not a date and time', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const cases = [
      [new Date(Date.now() - 60_000).toISOString(), 'Pick a go-live date after today.'],
      ['2026-11-20', 'Enter a valid date and time.'],
    ];

    for (const [publishAt, message] of cases) {
      const res = await as(owner, 'post', '/api/siteOwner/posts').send(
        newPost(website, { status: 'draft', publishAt }),
      );

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, publishAtError(message));
    }
  });

  it('leaves the go-live date unchanged on an edit that does not send it', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const publishAt = inADay();
    const post = await createPost(website, { status: 'draft', publishAt });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(editPost());

    assert.equal(res.status, 200);
    assert.equal(res.body.data.publishAt, publishAt.toISOString());
  });

  it('sets, changes and clears the go-live date on edit', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { status: 'draft' });
    const later = new Date(Date.now() + 2 * DAY_MS).toISOString();

    for (const publishAt of [inADay().toISOString(), later, null]) {
      const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
        editPost({ publishAt }),
      );

      assert.equal(res.status, 200);
      assert.equal(res.body.data.publishAt, publishAt);
    }
  });

  it('accepts an unchanged go-live date on edit even once it has passed', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const publishAt = new Date(Date.now() - 60_000);
    const post = await createPost(website, { status: 'draft', publishAt });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({ publishAt: publishAt.toISOString() }),
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.publishAt, publishAt.toISOString());
  });

  it('returns 400 for a new go-live date that has passed, or one on a published post', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const draft = await createPost(website, { status: 'draft' });
    const published = await createPost(website);
    const cases = [
      [draft, new Date(Date.now() - 60_000), 'Pick a go-live date after today.'],
      [published, inADay(), 'Only a draft can have a go-live date.'],
    ];

    for (const [post, publishAt, message] of cases) {
      const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
        editPost({ publishAt: publishAt.toISOString() }),
      );

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, publishAtError(message));
      const stored = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
      assert.equal(stored.postName, 'Post');
      assert.equal(stored.publishAt, null);
    }
  });

  it('clears the go-live date when the post is published by hand', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { status: 'draft', publishAt: inADay() });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      status: 'published',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'published');
    assert.equal(res.body.data.publishAt, null);
  });

  it('keeps the go-live date when a scheduled draft is set to draft again', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const publishAt = inADay();
    const post = await createPost(website, { status: 'draft', publishAt });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      status: 'draft',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.publishAt, publishAt.toISOString());
  });

  it('clears the go-live date on delete, so a restored post comes back unscheduled', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { status: 'draft', publishAt: inADay() });

    await as(owner, 'delete', `/api/siteOwner/posts/${post.id}`);
    const res = await as(owner, 'post', `/api/siteOwner/posts/${post.id}/restore`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'draft');
    assert.equal(res.body.data.publishAt, null);
  });
});

describe('post publishedAt (when it went live)', () => {
  it('stamps a post created as published, and leaves a draft null', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const before = Date.now();

    const published = await as(owner, 'post', '/api/siteOwner/posts').send(newPost(website));
    const draft = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { status: 'draft' }),
    );

    assert.ok(new Date(published.body.data.publishedAt).getTime() >= before);
    assert.equal(draft.body.data.publishedAt, null);
  });

  it('stamps it when a draft is published, keeps it on a repeat, and clears it on draft', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { status: 'draft' });
    const path = `/api/siteOwner/posts/${post.id}/status`;

    const published = await as(owner, 'patch', path).send({ status: 'published' });
    const repeated = await as(owner, 'patch', path).send({ status: 'published' });
    const drafted = await as(owner, 'patch', path).send({ status: 'draft' });

    assert.ok(published.body.data.publishedAt);
    assert.equal(repeated.body.data.publishedAt, published.body.data.publishedAt);
    assert.equal(drafted.body.data.publishedAt, null);
  });
});

describe('PATCH /api/siteOwner/posts/:id/publishAt', () => {
  const inADay = () => new Date(Date.now() + DAY_MS);
  const publishAtError = (message) => ({
    error: { message: 'Please fix the highlighted fields.', fields: { publishAt: message } },
  });

  it("sets and clears a draft's go-live date, returns the Post and records post.updated", async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { status: 'draft' });
    const path = `/api/siteOwner/posts/${post.id}/publishAt`;
    const publishAt = inADay().toISOString();

    const set = await as(owner, 'patch', path).send({ publishAt });
    const cleared = await as(owner, 'patch', path).send({ publishAt: null });

    assert.equal(set.status, 200);
    assert.equal(set.body.data.id, post.id);
    assert.equal(set.body.data.publishAt, publishAt);
    assert.equal(cleared.body.data.publishAt, null);
    assert.deepEqual(await auditEvents(), [
      postEvent(owner, 'post.updated', post.id, website.id),
      postEvent(owner, 'post.updated', post.id, website.id),
    ]);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('returns 400 for a missing, past or published-post go-live date', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const draft = await createPost(website, { status: 'draft' });
    const published = await createPost(website);
    const cases = [
      [draft, {}, 'Enter a valid date and time.'],
      [
        draft,
        { publishAt: new Date(Date.now() - 60_000).toISOString() },
        'Pick a go-live date after today.',
      ],
      [published, { publishAt: inADay().toISOString() }, 'Only a draft can have a go-live date.'],
    ];

    for (const [post, body, message] of cases) {
      const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/publishAt`).send(body);

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, publishAtError(message));
    }
    assert.deepEqual(await auditEvents(), []);
  });

  it("returns 404 for another site owner's post", async () => {
    const { owner } = await createOwnerWithWebsite();
    const { website: theirs } = await createOwnerWithWebsite();
    const post = await createPost(theirs, { status: 'draft' });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/publishAt`).send({
      publishAt: inADay().toISOString(),
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, POST_NOT_FOUND);
  });
});
