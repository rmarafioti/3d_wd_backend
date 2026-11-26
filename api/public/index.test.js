// Request tests for the public routes (api/public/index.js): posts, galleries and the contact form.
require('../../testing/setup');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../app');
const prisma = require('../../prisma');
const {
  CSRF,
  resetState,
  disconnect,
  createWebsite,
  createOwnerWithWebsite,
  auditEvents,
  mockFetch,
  waitFor,
  paragraph,
  imageSrc,
  imageElement,
  createPost,
  createGallery,
  createAbility,
  assertNoSecrets,
} = require('../../testing/helpers');

const INVALID_KEY = { error: { message: 'Invalid API key.' } };
const GALLERY_NOT_FOUND = { error: { message: 'Gallery not found.' } };
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
  it("returns the website's published, undeleted posts, newest first, as PublicPost with its slug, without postName", async () => {
    const { website, apiKey } = await createWebsite();
    const older = await createPost(website, {
      header: 'Older',
      slug: 'older',
      postDate: new Date('2026-10-01T00:00:00.000Z'),
      body: [
        imageElement(image(website)),
        paragraph('Intro'),
        imageElement(image(website, { altText: 'Second' })),
        paragraph('Outro'),
      ],
    });
    const newer = await createPost(website, { header: 'Newer', slug: 'newer' });
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
          slug: 'newer',
          header: 'Newer',
          subHeader: null,
          postDate: null,
          createdAt: newer.createdAt.toISOString(),
          updatedAt: newer.updatedAt.toISOString(),
          body: [{ type: 'paragraph', text: 'Body' }],
        },
        {
          id: older.id,
          slug: 'older',
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

function fetchGallery(apiKey, slug) {
  return request(app).get(`/api/public/galleries/${slug}`).set('Authorization', `Bearer ${apiKey}`);
}

describe('GET /api/public/galleries/:slug', () => {
  it('returns the published gallery as PublicGallery, with cropped versions and no internal fields', async () => {
    const { website, apiKey } = await createWebsite();
    const gallery = await createGallery(website, {
      galleryName: 'Internal name',
      slug: 'interior',
      title: 'Inside',
      copy: 'Our shop',
      images: [
        {
          src: imageSrc(website, 'a'),
          width: 1200,
          height: 800,
          altText: 'A',
          caption: 'Front room',
          thumbnailX: 200,
          thumbnailY: 0,
          thumbnailWidth: 800,
          thumbnailHeight: 800,
          mobileX: 400,
          mobileY: 0,
          mobileWidth: 400,
          mobileHeight: 800,
        },
        { src: imageSrc(website, 'b'), width: 600, height: 900, altText: 'B' },
      ],
    });
    const cropped = (transformation) =>
      imageSrc(website, 'a').replace('/image/upload/', `/image/upload/${transformation}/`);

    const res = await fetchGallery(apiKey, 'interior');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: {
        id: gallery.id,
        slug: 'interior',
        title: 'Inside',
        copy: 'Our shop',
        createdAt: gallery.createdAt.toISOString(),
        updatedAt: gallery.updatedAt.toISOString(),
        images: [
          {
            src: imageSrc(website, 'a'),
            width: 1200,
            height: 800,
            altText: 'A',
            caption: 'Front room',
            thumbnail: { src: cropped('c_crop,x_200,y_0,w_800,h_800'), width: 800, height: 800 },
            mobile: { src: cropped('c_crop,x_400,y_0,w_400,h_800'), width: 400, height: 800 },
          },
          {
            src: imageSrc(website, 'b'),
            width: 600,
            height: 900,
            altText: 'B',
            caption: null,
            thumbnail: null,
            mobile: null,
          },
        ],
      },
    });
    await assertNoSecrets(res.body);
  });

  it("returns 404 for a draft, a deleted, another website's or an unknown slug", async () => {
    const { website, apiKey } = await createWebsite();
    await createGallery(website, { slug: 'draft', status: 'draft' });
    await createGallery(website, { slug: 'deleted', deletedAt: new Date() });
    const { website: other } = await createWebsite();
    await createGallery(other, { slug: 'theirs' });

    for (const slug of ['draft', 'deleted', 'theirs', 'unknown']) {
      const res = await fetchGallery(apiKey, slug);

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, GALLERY_NOT_FOUND);
    }
  });

  it('returns 401 without a valid key', async () => {
    const { website } = await createWebsite();
    await createGallery(website, { slug: 'interior' });

    const res = await fetchGallery('not-a-real-key', 'interior');

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, INVALID_KEY);
  });

  it('shares the per website limit with the posts route', async () => {
    const { website, apiKey } = await createWebsite();
    await createGallery(website, { slug: 'interior' });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      assert.equal((await fetchPosts(apiKey)).status, 200);
    }

    const res = await fetchGallery(apiKey, 'interior');

    assert.equal(res.status, 429);
    assert.deepEqual(res.body, TOO_MANY_REQUESTS);
  });
});

describe('abilities on the public routes', () => {
  it('returns no posts while posts are turned off, and every published post once on', async () => {
    const { website, apiKey } = await createWebsite();
    const post = await createPost(website);
    const ability = await createAbility(website, 'posts', { status: 'live', turnedOn: false });

    const off = await fetchPosts(apiKey);
    await prisma.websiteAbility.update({ where: { id: ability.id }, data: { turnedOn: true } });
    const on = await fetchPosts(apiKey);

    assert.equal(off.status, 200);
    assert.deepEqual(off.body, { data: [] });
    assert.deepEqual(
      on.body.data.map((item) => item.id),
      [post.id],
    );
  });

  it('returns 404 for a gallery while galleries are turned off or removed', async () => {
    const { website, apiKey } = await createWebsite();
    await createGallery(website, { slug: 'art' });
    const ability = await createAbility(website, 'galleries', { status: 'live', turnedOn: false });

    const off = await fetchGallery(apiKey, 'art');
    await prisma.websiteAbility.update({
      where: { id: ability.id },
      data: { turnedOn: true, removedAt: new Date() },
    });
    const removed = await fetchGallery(apiKey, 'art');
    await prisma.websiteAbility.update({ where: { id: ability.id }, data: { removedAt: null } });
    const on = await fetchGallery(apiKey, 'art');

    assert.deepEqual([off.status, removed.status, on.status], [404, 404, 200]);
    assert.deepEqual(off.body, GALLERY_NOT_FOUND);
    assert.deepEqual(removed.body, GALLERY_NOT_FOUND);
  });

  it("shows another website's content as usual when only one website turned its ability off", async () => {
    const { website, apiKey } = await createWebsite();
    await createPost(website);
    const { website: other } = await createWebsite();
    await createAbility(other, 'posts', { status: 'live', turnedOn: false });

    const res = await fetchPosts(apiKey);

    assert.equal(res.body.data.length, 1);
  });
});

describe('POST /api/public/contact', () => {
  const RECEIVED = { data: { received: true } };
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  // A JPG of `size` bytes, as the form sends it.
  function photo(size = JPG.length) {
    return { content: Buffer.concat([JPG, Buffer.alloc(size - JPG.length)]).toString('base64') };
  }

  function sendMessage(apiKey, body = { name: 'Sam', email: 'Sam@Example.com' }) {
    return request(app)
      .post('/api/public/contact')
      .set(CSRF)
      .set('Authorization', `Bearer ${apiKey}`)
      .send(body);
  }

  function websiteInquiries() {
    return prisma.websiteInquiry.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        websiteId: true,
        name: true,
        email: true,
        message: true,
        extras: true,
        imageCount: true,
      },
    });
  }

  it('saves the message with its extras and photo count, and records it with no actor', async () => {
    const { website, apiKey } = await createWebsite();

    const res = await sendMessage(apiKey, {
      name: 'Sam',
      email: 'Sam@Example.com',
      message: 'Hello',
      extras: [
        { label: 'Phone', value: '555-0100' },
        { label: 'Service', value: '' },
      ],
      images: [photo(), photo()],
    });

    assert.equal(res.status, 201);
    assert.deepEqual(res.body, RECEIVED);
    await assertNoSecrets(res.body);
    const [inquiry] = await websiteInquiries();
    assert.deepEqual(inquiry, {
      id: inquiry.id,
      websiteId: website.id,
      name: 'Sam',
      email: 'sam@example.com',
      message: 'Hello',
      extras: [{ label: 'Phone', value: '555-0100' }],
      imageCount: 2,
    });
    assert.deepEqual(await auditEvents(), [
      {
        action: 'website_inquiry.received',
        actorId: null,
        actorEmail: null,
        targetType: 'website_inquiry',
        targetId: inquiry.id,
        metadata: { websiteId: website.id, imageCount: 2 },
      },
    ]);
  });

  it('stores null extras when the form sent none or only blank ones', async () => {
    const { apiKey } = await createWebsite();

    await sendMessage(apiKey, {
      name: 'Sam',
      email: 'sam@example.com',
      extras: [{ label: 'Q', value: ' ' }],
    });

    const [inquiry] = await websiteInquiries();
    assert.equal(inquiry.extras, null);
    assert.equal(inquiry.message, null);
  });

  it("emails the website's site owner with the photos attached, after answering", async (t) => {
    process.env.RESEND_API_KEY = 're_test_key';
    t.after(() => delete process.env.RESEND_API_KEY);
    const fetchMock = mockFetch(t.mock);
    const { owner, apiKey } = await createOwnerWithWebsite();
    const image = photo();

    const res = await sendMessage(apiKey, {
      name: 'Sam',
      email: 'sam@example.com',
      images: [image],
    });

    assert.equal(res.status, 201);
    const body = await waitFor(() => {
      assert.equal(fetchMock.mock.callCount(), 1);
      return JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
    });
    assert.deepEqual(body.to, [owner.email]);
    assert.equal(body.reply_to, 'sam@example.com');
    assert.deepEqual(body.attachments, [{ filename: 'photo-1.jpg', content: image.content }]);
  });

  it('still answers 201 and keeps the message when the email fails', async (t) => {
    process.env.RESEND_API_KEY = 're_test_key';
    t.after(() => delete process.env.RESEND_API_KEY);
    const errors = t.mock.method(console, 'error', () => {});
    mockFetch(t.mock, new TypeError('fetch failed'));
    const { apiKey } = await createOwnerWithWebsite();

    const res = await sendMessage(apiKey);

    assert.equal(res.status, 201);
    await waitFor(() => assert.equal(errors.mock.callCount(), 1));
    assert.equal((await websiteInquiries()).length, 1);
  });

  it('accepts a body over the 256 KB app limit: three photos of 1 MB', async () => {
    const { apiKey } = await createWebsite();
    const oneMb = 1024 * 1024;

    const res = await sendMessage(apiKey, {
      name: 'Sam',
      email: 'sam@example.com',
      images: [photo(oneMb), photo(oneMb), photo(oneMb)],
    });

    assert.equal(res.status, 201);
  });

  it('returns 413 for a body over 5 MB, and other routes keep their 256 KB limit', async () => {
    const { apiKey } = await createWebsite();

    const res = await sendMessage(apiKey, {
      name: 'Sam',
      email: 'sam@example.com',
      message: 'a'.repeat(5 * 1024 * 1024),
    });
    const landing = await request(app)
      .post('/api/contact')
      .set(CSRF)
      .send({ goal: 'a'.repeat(300 * 1024) });

    assert.equal(res.status, 413);
    assert.deepEqual(res.body, { error: { message: 'Request body is too large.' } });
    assert.equal(landing.status, 413);
  });

  it('returns 400 with fields keyed by full path, and saves nothing', async () => {
    const { apiKey } = await createWebsite();

    const res = await sendMessage(apiKey, {
      email: 'sam@example.com',
      extras: [{ label: '', value: 'A' }],
      images: [{ content: Buffer.from('GIF89a').toString('base64') }],
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: {
          name: 'Name is required.',
          'extras.0.label': 'Label is required.',
          'images.0.content': 'Each image must be a JPG, PNG or WebP.',
        },
      },
    });
    assert.equal((await websiteInquiries()).length, 0);
  });

  it('returns 401 for a missing key, an unknown key and an inactive website', async () => {
    const { apiKey } = await createWebsite({ active: false });

    const missing = await request(app)
      .post('/api/public/contact')
      .set(CSRF)
      .send({ name: 'Sam', email: 'sam@example.com' });
    const unknown = await sendMessage('not-a-key');
    const inactive = await sendMessage(apiKey);

    for (const res of [missing, unknown, inactive]) {
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, INVALID_KEY);
    }
    assert.equal((await websiteInquiries()).length, 0);
  });

  it('returns 403 without the CSRF header', async () => {
    const { apiKey } = await createWebsite();

    const res = await request(app)
      .post('/api/public/contact')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ name: 'Sam', email: 'sam@example.com' });

    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: { message: 'Request blocked.' } });
  });

  it("never counts toward the website's content limit, so form traffic can't block its posts", async () => {
    const { apiKey } = await createWebsite();
    for (let attempt = 0; attempt < 30; attempt += 1) await sendMessage(apiKey);

    const res = await fetchPosts(apiKey);

    assert.equal(res.status, 200);
  });

  it('returns 429 for the 21st message from one website within an hour, per website', async () => {
    const { apiKey } = await createWebsite();
    const { apiKey: otherKey } = await createWebsite();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      assert.equal((await sendMessage(apiKey)).status, 201);
    }

    const res = await sendMessage(apiKey);
    const other = await sendMessage(otherKey);

    assert.equal(res.status, 429);
    assert.deepEqual(res.body, TOO_MANY_REQUESTS);
    assert.equal(other.status, 201);
  });
});
