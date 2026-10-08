// Request tests for the site owner routes (api/siteOwner/index.js): websites with post summaries
// and post create / read / edit / status. Covers the role guard, the ownership rule (another
// owner's or an inactive website's data is a 404), validation, the body order and the edit
// reconcile, and the revalidation call after every change. fetch is mocked in every test, so no call leaves the
// machine.
require('../../testing/setup');
const { describe, it, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../app');
const prisma = require('../../prisma');
const {
  CSRF,
  resetDatabase,
  disconnect,
  createAdmin,
  createSiteOwner,
  createWebsite,
  paragraph,
  imageElement,
  createPost,
  createOwnerWithWebsite,
  sessionCookie,
  assertNoSecrets,
  mockFetch,
  waitFor,
} = require('../../testing/helpers');

const POST_NOT_FOUND = { error: { message: 'Post not found.' } };
const WEBSITE_NOT_FOUND = { error: { message: 'Website not found.' } };
const UNKNOWN_ID = '019a0000-0000-7000-8000-000000000000';

const IMAGE = { src: 'https://res.cloudinary.com/a.jpg', width: 800, height: 600, altText: 'A' };
const LINK = { name: 'Shop', url: 'https://shop.example.com' };

let fetchMock;

beforeEach(async () => {
  await resetDatabase();
  fetchMock = mockFetch(mock);
});
afterEach(() => mock.restoreAll());
after(disconnect);

// Sends a request as the given account. Writes carry the CSRF header.
function as(account, method, path) {
  const req = request(app)[method](path).set('Cookie', sessionCookie(account));
  return method === 'get' ? req : req.set(CSRF);
}

// A valid create body for the website; override any field.
function newPost(website, overrides = {}) {
  return {
    websiteId: website.id,
    postName: 'Post',
    body: [paragraph()],
    links: [],
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
    links: [],
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
  it("returns only the owner's active websites, sorted, with post summaries newest first", async () => {
    const owner = await createSiteOwner();
    const { website: beta } = await createWebsite({ websiteName: 'Beta' });
    const { website: alpha } = await createWebsite({ websiteName: 'Alpha' });
    const { website: archived } = await createWebsite({ websiteName: 'Archived', active: false });
    for (const website of [beta, alpha, archived]) {
      await prisma.accountWebsite.create({ data: { accountId: owner.id, websiteId: website.id } });
    }
    await createOwnerWithWebsite({ websiteName: 'Not Mine' });
    const older = await createPost(alpha, { postName: 'Older', active: false });
    const newer = await createPost(alpha, {
      postName: 'Newer',
      postDate: new Date('2026-10-01T00:00:00.000Z'),
    });

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
              createdAt: newer.createdAt.toISOString(),
            },
            {
              id: older.id,
              postName: 'Older',
              postDate: null,
              active: false,
              createdAt: older.createdAt.toISOString(),
            },
          ],
        },
        { id: beta.id, websiteName: 'Beta', url: beta.url, active: true, posts: [] },
      ],
    });
    await assertNoSecrets(res.body);
  });
});

describe('POST /api/siteOwner/posts', () => {
  it('creates a post with its body in order and its links, and returns the Post shape', async () => {
    const { owner, website } = await createOwnerWithWebsite({ websiteName: 'Stevie The Dog' });
    const second = { ...IMAGE, src: 'https://res.cloudinary.com/b.jpg', altText: 'B' };

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, {
        postName: ' First Post ',
        header: 'Hello',
        subHeader: 'World',
        postDate: '2026-10-07',
        body: [
          imageElement(IMAGE),
          paragraph(' First paragraph.\nSecond line. '),
          imageElement(second),
          paragraph('Last paragraph.'),
        ],
        links: [LINK],
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
      'links',
      'postDate',
      'postName',
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
    const storedImages = await prisma.image.findMany({ where: { postId: post.id } });
    const imageId = (src) => storedImages.find((image) => image.src === src).id;
    assert.deepEqual(post.body, [
      { type: 'image', image: { id: imageId(IMAGE.src), ...IMAGE } },
      { type: 'paragraph', text: 'First paragraph.\nSecond line.' },
      { type: 'image', image: { id: imageId(second.src), ...second } },
      { type: 'paragraph', text: 'Last paragraph.' },
    ]);
    assert.deepEqual(
      post.links.map(({ id, ...link }) => link),
      [LINK],
    );
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

  it('creates an archived post when active is false', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { active: false }),
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.active, false);
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

  it('returns 400 with fields keyed by the full path to each bad input', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, {
        postName: '',
        body: [paragraph(), imageElement({ ...IMAGE, src: 'http://insecure.example.com/a.jpg' })],
        links: [LINK, LINK, { name: 'Bad', url: 'not a url' }],
      }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: {
          postName: 'Post name is required.',
          'body.1.image.src': 'Must be a valid URL starting with https://',
          'links.2.url': 'Must be a valid URL starting with https://',
        },
      },
    });
    assert.equal(await prisma.post.count(), 0);
  });

  it('returns 400 for a body without a paragraph and saves nothing', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/posts').send(
      newPost(website, { body: [imageElement(IMAGE)] }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, { body: 'Add at least one paragraph.' });
    assert.equal(await prisma.post.count(), 0);
    assert.equal(await prisma.image.count(), 0);
  });
});

describe('GET /api/siteOwner/posts/:id', () => {
  it('returns the post with its website name, body in order and links', async () => {
    const { owner, website } = await createOwnerWithWebsite({ websiteName: 'Stevie The Dog' });
    const post = await createPost(website, {
      header: 'Hello',
      body: [paragraph('Intro'), imageElement(IMAGE), paragraph('Outro')],
      links: [LINK],
    });
    const { postId, ...image } = post.images[0];

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
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
        body: [
          { type: 'paragraph', text: 'Intro' },
          { type: 'image', image },
          { type: 'paragraph', text: 'Outro' },
        ],
        links: post.links.map(({ postId, ...link }) => link),
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
  it('updates kept items, inserts new ones and deletes the missing ones', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, {
      body: [paragraph(), imageElement(IMAGE), imageElement({ ...IMAGE, altText: 'Removed' })],
      links: [LINK, { ...LINK, name: 'Removed' }],
    });
    const [keptImage, removedImage] = post.images;
    const [keptLink, removedLink] = post.links;

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({
        header: 'New header',
        postDate: '2026-10-07',
        body: [
          paragraph('Edited body'),
          imageElement({ id: keptImage.id, ...IMAGE, altText: 'Updated' }),
          imageElement({ ...IMAGE, altText: 'Added' }),
        ],
        links: [
          { id: keptLink.id, ...LINK, name: 'Updated' },
          { ...LINK, name: 'Added' },
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
    assert.deepEqual(
      edited.links.map((link) => [link.id === keptLink.id, link.name]),
      [
        [true, 'Updated'],
        [false, 'Added'],
      ],
    );
    assert.equal(await prisma.image.findUnique({ where: { id: removedImage.id } }), null);
    assert.equal(await prisma.link.findUnique({ where: { id: removedLink.id } }), null);
    assert.ok(new Date(edited.updatedAt) > post.updatedAt);
    await revalidationCall();
  });

  it('reorders the body, keeping image ids and leaving no stale elements', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, {
      body: [paragraph('One'), paragraph('Two'), imageElement(IMAGE)],
    });
    const imageId = post.images[0].id;

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({ body: [imageElement({ id: imageId, ...IMAGE }), paragraph('Two')] }),
    );

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.body, [
      { type: 'image', image: { id: imageId, ...IMAGE } },
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

  it('ignores websiteId and active in the body', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const { website: otherOwnWebsite } = await createWebsite();
    await prisma.accountWebsite.create({
      data: { accountId: owner.id, websiteId: otherOwnWebsite.id },
    });
    const post = await createPost(website);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({ websiteId: otherOwnWebsite.id, active: false }),
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.websiteId, website.id);
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
    const otherPost = await createPost(website, { body: [paragraph(), imageElement(IMAGE)] });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({
        body: [paragraph(), imageElement({ id: otherPost.images[0].id, ...IMAGE })],
      }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: { message: 'Invalid image or link.' } });
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.postName, 'Original');
    assert.equal(await prisma.image.count({ where: { postId: otherPost.id } }), 1);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('returns 400 for an image id sent twice', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { body: [paragraph(), imageElement(IMAGE)] });
    const image = { id: post.images[0].id, ...IMAGE };

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({ body: [paragraph(), imageElement(image), imageElement(image)] }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: { message: 'Invalid image or link.' } });
  });

  it('returns 400 for a link id sent twice', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { links: [LINK] });
    const linkId = post.links[0].id;

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}`).send(
      editPost({
        links: [
          { id: linkId, ...LINK },
          { id: linkId, ...LINK },
        ],
      }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: { message: 'Invalid image or link.' } });
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
  it('archives a post and returns the Post shape', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      active: false,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, post.id);
    assert.equal(res.body.data.active, false);
    assert.equal(res.body.data.websiteName, website.websiteName);
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.active, false);
    await revalidationCall();
  });

  it('makes an archived post active again', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { active: false });

    const res = await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({
      active: true,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.active, true);
    await revalidationCall();
  });

  it('calls the revalidation webhook for the post after a status change', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website);

    await as(owner, 'patch', `/api/siteOwner/posts/${post.id}/status`).send({ active: false });

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
      active: false,
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, POST_NOT_FOUND);
    const stored = await prisma.post.findUnique({ where: { id: post.id } });
    assert.equal(stored.active, true);
  });
});
