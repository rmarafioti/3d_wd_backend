// Request tests for the site owner gallery routes (api/siteOwner/galleries.js).
require('../../testing/setup');
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
  createWebsite,
  linkWebsite,
  imageSrc,
  createGallery,
  createAbility,
  createOwnerWithWebsite,
  sessionCookie,
  assertNoSecrets,
  auditEvents,
  mockFetch,
  waitFor,
} = require('../../testing/helpers');

const GALLERY_NOT_FOUND = { error: { message: 'Gallery not found.' } };
const WEBSITE_NOT_FOUND = { error: { message: 'Website not found.' } };
const INVALID_IMAGE = { error: { message: 'Invalid image.' } };
const NAME_TAKEN = { error: { message: 'A gallery with this name already exists.' } };
const UNKNOWN_ID = '019a0000-0000-7000-8000-000000000000';

let fetchMock;

beforeEach(async () => {
  await resetState();
  fetchMock = mockFetch(mock);
});
afterEach(() => mock.restoreAll());
after(disconnect);

// A site owner whose website has the Photo Galleries ability, as every gallery route needs.
async function ownerWithGalleries(websiteOverrides) {
  const created = await createOwnerWithWebsite(websiteOverrides);
  await createAbility(created.website, 'galleries');
  return created;
}

// Sends a request as the given account. Writes carry the CSRF header.
function as(account, method, path) {
  const req = request(app)[method](path).set('Cookie', sessionCookie(account));
  return method === 'get' ? req : req.set(CSRF);
}

// A gallery image in the website's upload folder, as a request sends it; override any field.
function image(website, overrides = {}) {
  return { src: imageSrc(website), width: 1200, height: 800, altText: 'A', ...overrides };
}

// A valid create body for the website; override any field.
function newGallery(website, overrides = {}) {
  return {
    websiteId: website.id,
    galleryName: 'Interior',
    images: [image(website)],
    ...overrides,
  };
}

// A valid full edit body; override any field.
function editGallery(website, overrides = {}) {
  return {
    galleryName: 'Edited',
    title: null,
    copy: null,
    images: [image(website)],
    ...overrides,
  };
}

// The audit event a site owner's gallery change writes, as audit_event rows return it.
function galleryEvent(owner, action, galleryId, websiteId) {
  return {
    action,
    actorId: owner.id,
    actorEmail: owner.email,
    targetType: 'gallery',
    targetId: galleryId,
    metadata: { websiteId },
  };
}

// Waits for the fire-and-forget revalidation call and returns the body it sent.
async function revalidationBody() {
  await waitFor(() => assert.equal(fetchMock.mock.callCount(), 1));
  const [, options] = fetchMock.mock.calls[0].arguments;
  return JSON.parse(options.body);
}

// A stored gallery image row: no crops unless given.
function storedImage(website, overrides = {}) {
  return { src: imageSrc(website), width: 1200, height: 800, altText: 'A', ...overrides };
}

describe('site owner gallery route guards', () => {
  const routes = [
    ['post', '/api/siteOwner/galleries'],
    ['get', '/api/siteOwner/galleries/some-id'],
    ['patch', '/api/siteOwner/galleries/some-id'],
    ['patch', '/api/siteOwner/galleries/some-id/status'],
    ['patch', '/api/siteOwner/galleries/some-id/publishAt'],
    ['post', '/api/siteOwner/galleries/some-id/request'],
    ['patch', '/api/siteOwner/galleries/some-id/request'],
    ['delete', '/api/siteOwner/galleries/some-id'],
  ];

  for (const [method, path] of routes) {
    it(`returns 401 for ${method.toUpperCase()} ${path} without a session`, async () => {
      const res = await request(app)[method](path).set(CSRF);

      assert.equal(res.status, 401);
      assert.deepEqual(res.body, {
        error: { message: 'Your session expired, please sign in again.' },
      });
    });

    it(`returns 403 for ${method.toUpperCase()} ${path} as the admin`, async () => {
      const admin = await createAdmin();

      const res = await as(admin, method, path);

      assert.equal(res.status, 403);
      assert.deepEqual(res.body, { error: { message: 'You do not have access to this page.' } });
    });
  }

  it('returns 403 for a write without the CSRF header', async () => {
    const { owner, website } = await ownerWithGalleries();

    const res = await request(app)
      .post('/api/siteOwner/galleries')
      .set('Cookie', sessionCookie(owner))
      .send(newGallery(website));

    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: { message: 'Request blocked.' } });
  });
});

describe('POST /api/siteOwner/galleries', () => {
  it('creates a gallery with its images in order and crops, and returns the Gallery shape', async () => {
    const { owner, website } = await ownerWithGalleries({ websiteName: 'Stevie The Dog' });
    const first = image(website, {
      src: imageSrc(website, 'a'),
      caption: ' The front room ',
      thumbnailCrop: { x: 200, y: 0, width: 800, height: 800 },
      mobileCrop: { x: 400, y: 0, width: 400, height: 800 },
    });
    const second = image(website, {
      src: imageSrc(website, 'b'),
      altText: 'B',
      thumbnailCrop: { x: 0, y: 0, width: 600, height: 600 },
      mobileCrop: { x: 0, y: 0, width: 300, height: 600 },
    });

    const res = await as(owner, 'post', '/api/siteOwner/galleries').send(
      newGallery(website, {
        galleryName: ' Our Interior! ',
        title: 'Inside the shop',
        copy: 'Line one\nLine two',
        images: [first, second],
      }),
    );

    assert.equal(res.status, 201);
    const { data } = res.body;
    const stored = await prisma.galleryImage.findMany({
      where: { galleryId: data.id },
      orderBy: { position: 'asc' },
    });
    assert.deepEqual(data, {
      id: data.id,
      websiteId: website.id,
      websiteName: 'Stevie The Dog',
      galleryName: 'Our Interior!',
      slug: data.slug,
      title: 'Inside the shop',
      copy: 'Line one\nLine two',
      status: 'published',
      placement: null,
      requestNote: null,
      requestedAt: null,
      publishAt: null,
      publishedAt: data.publishedAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      images: [
        {
          id: stored[0].id,
          src: first.src,
          width: 1200,
          height: 800,
          altText: 'A',
          caption: 'The front room',
          thumbnailCrop: { x: 200, y: 0, width: 800, height: 800 },
          mobileCrop: { x: 400, y: 0, width: 400, height: 800 },
        },
        {
          id: stored[1].id,
          src: second.src,
          width: 1200,
          height: 800,
          altText: 'B',
          caption: null,
          thumbnailCrop: { x: 0, y: 0, width: 600, height: 600 },
          mobileCrop: { x: 0, y: 0, width: 300, height: 600 },
        },
      ],
    });
    await assertNoSecrets(res.body);
  });

  it('stores blank optional fields as null and saves a draft when asked', async () => {
    const { owner, website } = await ownerWithGalleries();

    const res = await as(owner, 'post', '/api/siteOwner/galleries').send(
      newGallery(website, { title: '   ', copy: null, status: 'draft' }),
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.title, null);
    assert.equal(res.body.data.copy, null);
    assert.equal(res.body.data.status, 'draft');
  });

  it('gives a new gallery a slug of 8 random lowercase letters and digits, not its name', async () => {
    const { owner, website } = await ownerWithGalleries();
    const send = () =>
      as(owner, 'post', '/api/siteOwner/galleries').send(
        newGallery(website, { galleryName: 'Art' }),
      );

    const first = await send();
    await as(owner, 'delete', `/api/siteOwner/galleries/${first.body.data.id}`);
    const second = await send();

    for (const res of [first, second]) {
      assert.equal(res.status, 201);
      assert.match(res.body.data.slug, /^[a-z0-9]{8}$/);
    }
    assert.notEqual(first.body.data.slug, second.body.data.slug);
  });

  it("returns 409 for a name another of the website's galleries has, in any case", async () => {
    const { owner, website } = await ownerWithGalleries();
    await createGallery(website, { galleryName: 'Interior' });

    const res = await as(owner, 'post', '/api/siteOwner/galleries').send(
      newGallery(website, { galleryName: ' INTERIOR ' }),
    );

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, NAME_TAKEN);
    assert.equal(await prisma.gallery.count(), 1);
  });

  it("allows a deleted gallery's name, or another website's", async () => {
    const { owner, website } = await ownerWithGalleries();
    await createGallery(website, { galleryName: 'Interior', deletedAt: new Date() });
    const { website: other } = await createWebsite();
    await createGallery(other, { galleryName: 'Interior' });

    const res = await as(owner, 'post', '/api/siteOwner/galleries').send(newGallery(website));

    assert.equal(res.status, 201);
  });

  it('creates one of two same-name galleries sent at once and refuses the other', async () => {
    const { owner, website } = await ownerWithGalleries();
    const send = () => as(owner, 'post', '/api/siteOwner/galleries').send(newGallery(website));

    const statuses = (await Promise.all([send(), send()])).map((res) => res.status).sort();

    assert.deepEqual(statuses, [201, 409]);
    assert.equal(await prisma.gallery.count(), 1);
  });

  it('creates two different galleries sent at once, each with its own slug', async () => {
    const { owner, website } = await ownerWithGalleries();
    const send = (galleryName) =>
      as(owner, 'post', '/api/siteOwner/galleries').send(newGallery(website, { galleryName }));

    const responses = await Promise.all([send('Art'), send('Prints')]);

    assert.deepEqual(
      responses.map((res) => res.status),
      [201, 201],
    );
    assert.notEqual(responses[0].body.data.slug, responses[1].body.data.slug);
  });

  it('records the new gallery in the audit log and revalidates the website', async () => {
    const { owner, website } = await ownerWithGalleries();

    const res = await as(owner, 'post', '/api/siteOwner/galleries').send(newGallery(website));

    assert.deepEqual(await auditEvents(), [
      galleryEvent(owner, 'gallery.created', res.body.data.id, website.id),
    ]);
    assert.deepEqual(await revalidationBody(), {
      websiteId: website.id,
      galleryId: res.body.data.id,
    });
  });

  it("returns 404 for another owner's website or an inactive one", async () => {
    const { owner } = await ownerWithGalleries();
    const { website: notMine } = await ownerWithGalleries();
    const { website: inactive } = await createWebsite({ active: false });
    await linkWebsite(owner, inactive);

    for (const website of [notMine, inactive]) {
      const res = await as(owner, 'post', '/api/siteOwner/galleries').send(newGallery(website));

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, WEBSITE_NOT_FOUND);
    }
    assert.equal(await prisma.gallery.count(), 0);
  });

  it('returns 403 on a website without the Photo Galleries ability, or with it removed', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const { website: removed } = await createOwnerWithWebsite();
    await linkWebsite(owner, removed);
    await createAbility(removed, 'galleries', { removedAt: new Date() });

    for (const target of [website, removed]) {
      const res = await as(owner, 'post', '/api/siteOwner/galleries').send(newGallery(target));

      assert.equal(res.status, 403);
      assert.deepEqual(res.body, {
        error: { message: 'Add Photo Galleries to this website first.' },
      });
    }
    assert.equal(await prisma.gallery.count(), 0);
  });

  it("returns 400 Invalid image. for an image outside the website's folder", async () => {
    const { owner, website } = await ownerWithGalleries();
    const { website: other } = await createWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/galleries').send(
      newGallery(website, { images: [image(other)] }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, INVALID_IMAGE);
    assert.equal(await prisma.gallery.count(), 0);
  });

  it('returns 400 with a message per field for invalid input', async () => {
    const { owner, website } = await ownerWithGalleries();
    const tooMany = Array.from({ length: 31 }, () => image(website));

    const cases = [
      [{ galleryName: ' ' }, { galleryName: 'Gallery name is required.' }],
      [{ images: [] }, { images: 'Add at least one image.' }],
      [{ images: tooMany }, { images: 'A gallery can have at most 30 images.' }],
      [
        { images: [image(website, { caption: 'x'.repeat(301) })] },
        { 'images.0.caption': 'Caption must be 300 characters or fewer.' },
      ],
      [{ status: 'live' }, { status: 'Status must be draft or published.' }],
    ];
    for (const [overrides, fields] of cases) {
      const res = await as(owner, 'post', '/api/siteOwner/galleries').send(
        newGallery(website, overrides),
      );

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, {
        error: { message: 'Please fix the highlighted fields.', fields },
      });
    }
  });

  it('returns 400 for a crop that is outside the image or the wrong shape', async () => {
    const { owner, website } = await ownerWithGalleries();
    const thumbnail = 'Thumbnail crop must be a square inside the image.';
    const mobile = 'Mobile crop must be inside the image and at least as tall as it is wide.';

    const cases = [
      [{ thumbnailCrop: { x: 0, y: 0, width: 800, height: 600 } }, 'thumbnailCrop', thumbnail],
      [{ thumbnailCrop: { x: 500, y: 0, width: 800, height: 800 } }, 'thumbnailCrop', thumbnail],
      [{ thumbnailCrop: { x: -1, y: 0, width: 800, height: 800 } }, 'thumbnailCrop.x', thumbnail],
      [{ mobileCrop: { x: 0, y: 0, width: 900, height: 800 } }, 'mobileCrop', mobile],
      [{ mobileCrop: { x: 0, y: 100, width: 400, height: 800 } }, 'mobileCrop', mobile],
    ];
    for (const [crop, field, message] of cases) {
      const res = await as(owner, 'post', '/api/siteOwner/galleries').send(
        newGallery(website, { images: [image(website, crop)] }),
      );

      assert.equal(res.status, 400);
      assert.deepEqual(res.body.error.fields, { [`images.0.${field}`]: message });
    }
  });

  it('accepts a crop that fills the image exactly', async () => {
    const { owner, website } = await ownerWithGalleries();
    const crops = {
      thumbnailCrop: { x: 400, y: 0, width: 800, height: 800 },
      mobileCrop: { x: 0, y: 0, width: 800, height: 800 },
    };

    const res = await as(owner, 'post', '/api/siteOwner/galleries').send(
      newGallery(website, { images: [image(website, crops)] }),
    );

    assert.equal(res.status, 201);
  });

  it('returns 400 on images when the crops are not the same across the gallery', async () => {
    const { owner, website } = await ownerWithGalleries();
    const square = { x: 0, y: 0, width: 800, height: 800 };
    const fourByFive = { x: 0, y: 0, width: 640, height: 800 };
    const nineBySixteen = { x: 0, y: 0, width: 450, height: 800 };

    const cases = [
      [[{ thumbnailCrop: square }, {}], 'Add a thumbnail crop to every image, or remove them all.'],
      [[{}, { mobileCrop: fourByFive }], 'Add a mobile crop to every image, or remove them all.'],
      [
        [{ mobileCrop: fourByFive }, { mobileCrop: nineBySixteen }],
        'Every mobile crop must be the same shape.',
      ],
    ];
    for (const [crops, message] of cases) {
      const res = await as(owner, 'post', '/api/siteOwner/galleries').send(
        newGallery(website, {
          images: crops.map((crop, index) =>
            image(website, { src: imageSrc(website, `${index}`), ...crop }),
          ),
        }),
      );

      assert.equal(res.status, 400);
      assert.deepEqual(res.body.error.fields, { images: message });
    }
    assert.equal(await prisma.gallery.count(), 0);
  });

  it('accepts mobile crops of one shape within whole-pixel rounding', async () => {
    const { owner, website } = await ownerWithGalleries();
    const images = [
      { x: 0, y: 0, width: 640, height: 800 },
      { x: 0, y: 0, width: 626, height: 782 },
    ].map((mobileCrop, index) =>
      image(website, {
        src: imageSrc(website, `${index}`),
        thumbnailCrop: { x: 0, y: 0, width: 800, height: 800 },
        mobileCrop,
      }),
    );

    const res = await as(owner, 'post', '/api/siteOwner/galleries').send(
      newGallery(website, { images }),
    );

    assert.equal(res.status, 201);
  });
});

describe('GET /api/siteOwner/galleries/:id', () => {
  it('returns the gallery with its images in order', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, {
      images: [
        storedImage(website, { src: imageSrc(website, 'b'), altText: 'B' }),
        storedImage(website, {
          thumbnailX: 0,
          thumbnailY: 0,
          thumbnailWidth: 800,
          thumbnailHeight: 800,
        }),
      ],
    });

    const res = await as(owner, 'get', `/api/siteOwner/galleries/${gallery.id}`);

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.images.map((item) => [item.altText, item.thumbnailCrop]),
      [
        ['B', null],
        ['A', { x: 0, y: 0, width: 800, height: 800 }],
      ],
    );
  });

  it("returns 404 for another owner's, a deleted or an unknown gallery", async () => {
    const { owner, website } = await ownerWithGalleries();
    const { website: notMine } = await ownerWithGalleries();
    const others = await createGallery(notMine);
    const deleted = await createGallery(website, { deletedAt: new Date() });

    for (const id of [others.id, deleted.id, UNKNOWN_ID]) {
      const res = await as(owner, 'get', `/api/siteOwner/galleries/${id}`);

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, GALLERY_NOT_FOUND);
    }
  });
});

describe('PATCH /api/siteOwner/galleries/:id', () => {
  it('reorders and updates kept images, deletes missing ones and adds new ones', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, {
      images: [
        storedImage(website, { src: imageSrc(website, 'a'), altText: 'A' }),
        storedImage(website, { src: imageSrc(website, 'b'), altText: 'B' }),
        storedImage(website, { src: imageSrc(website, 'c'), altText: 'C' }),
      ],
    });
    const [a, b, c] = gallery.images;

    const mobileCrop = { x: 0, y: 0, width: 400, height: 800 };

    const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}`).send(
      editGallery(website, {
        images: [
          image(website, { id: c.id, src: c.src, altText: 'C edited', mobileCrop }),
          image(website, { src: imageSrc(website, 'd'), altText: 'D', mobileCrop }),
          image(website, { id: a.id, src: a.src, altText: 'A', mobileCrop }),
        ],
      }),
    );

    assert.equal(res.status, 200);
    const images = res.body.data.images;
    assert.deepEqual(
      images.map((item) => item.altText),
      ['C edited', 'D', 'A'],
    );
    assert.equal(images[0].id, c.id);
    assert.equal(images[2].id, a.id);
    assert.deepEqual(images[2].mobileCrop, mobileCrop);
    assert.equal(await prisma.galleryImage.count({ where: { id: b.id } }), 0);
  });

  it('returns 400 on images when the edit leaves an image without the thumbnail crop the others have', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, { images: [storedImage(website)] });
    const [stored] = gallery.images;

    const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}`).send(
      editGallery(website, {
        images: [
          image(website, { id: stored.id, src: stored.src }),
          image(website, {
            src: imageSrc(website, 'b'),
            thumbnailCrop: { x: 0, y: 0, width: 800, height: 800 },
          }),
        ],
      }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, {
      images: 'Add a thumbnail crop to every image, or remove them all.',
    });
  });

  it('keeps the slug, website and status when the gallery is renamed', async () => {
    const { owner, website } = await ownerWithGalleries();
    const { website: other } = await ownerWithGalleries();
    const gallery = await createGallery(website, { slug: 'interior', status: 'draft' });

    const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}`).send(
      editGallery(website, {
        galleryName: 'Shop Interior 2027',
        slug: 'shop',
        status: 'published',
        websiteId: other.id,
      }),
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.galleryName, 'Shop Interior 2027');
    assert.equal(res.body.data.slug, 'interior');
    assert.equal(res.body.data.status, 'draft');
    assert.equal(res.body.data.websiteId, website.id);
  });

  it("returns 409 for another gallery's name and changes nothing, but keeps its own", async () => {
    const { owner, website } = await ownerWithGalleries();
    await createGallery(website, { galleryName: 'Art' });
    const gallery = await createGallery(website, { galleryName: 'Interior' });
    const path = `/api/siteOwner/galleries/${gallery.id}`;

    const taken = await as(owner, 'patch', path).send(editGallery(website, { galleryName: 'art' }));
    const own = await as(owner, 'patch', path).send(
      editGallery(website, { galleryName: 'interior' }),
    );

    assert.equal(taken.status, 409);
    assert.deepEqual(taken.body, NAME_TAKEN);
    assert.equal(own.status, 200);
    assert.equal(own.body.data.galleryName, 'interior');
  });

  it("returns 400 Invalid image. for another gallery's image id or an id sent twice", async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, { images: [storedImage(website)] });
    const other = await createGallery(website, { images: [storedImage(website)] });
    const [own] = gallery.images;

    const cases = [
      [image(website, { id: other.images[0].id })],
      [image(website, { id: own.id }), image(website, { id: own.id })],
    ];
    for (const images of cases) {
      const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}`).send(
        editGallery(website, { images }),
      );

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, INVALID_IMAGE);
    }
    assert.equal(await prisma.galleryImage.count({ where: { galleryId: other.id } }), 1);
  });

  it('records the edit in the audit log and revalidates the website', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website);

    await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}`).send(editGallery(website));

    assert.deepEqual(await auditEvents(), [
      galleryEvent(owner, 'gallery.updated', gallery.id, website.id),
    ]);
    assert.deepEqual(await revalidationBody(), { websiteId: website.id, galleryId: gallery.id });
  });

  it("returns 404 for another owner's gallery and changes nothing", async () => {
    const { owner } = await ownerWithGalleries();
    const { website: notMine } = await ownerWithGalleries();
    const gallery = await createGallery(notMine);

    const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}`).send(
      editGallery(notMine),
    );

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, GALLERY_NOT_FOUND);
    const stored = await prisma.gallery.findUnique({ where: { id: gallery.id } });
    assert.equal(stored.galleryName, 'Gallery');
  });
});

describe('PATCH /api/siteOwner/galleries/:id/status', () => {
  it('sets a gallery to draft and back to published, each in the audit log', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website);
    const path = `/api/siteOwner/galleries/${gallery.id}/status`;

    const drafted = await as(owner, 'patch', path).send({ status: 'draft' });
    const published = await as(owner, 'patch', path).send({ status: 'published' });

    assert.equal(drafted.body.data.status, 'draft');
    assert.equal(published.body.data.status, 'published');
    assert.deepEqual(await auditEvents(), [
      galleryEvent(owner, 'gallery.drafted', gallery.id, website.id),
      galleryEvent(owner, 'gallery.published', gallery.id, website.id),
    ]);
  });

  it('revalidates the website after a status change', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website);

    await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}/status`).send({
      status: 'draft',
    });

    assert.deepEqual(await revalidationBody(), { websiteId: website.id, galleryId: gallery.id });
  });

  it('returns 400 on status when it is missing or not draft or published', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website);

    for (const body of [{}, { status: 'archived' }]) {
      const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}/status`).send(
        body,
      );

      assert.equal(res.status, 400);
      assert.deepEqual(res.body.error.fields, { status: 'Status must be draft or published.' });
    }
  });

  it("returns 404 for another owner's gallery", async () => {
    const { owner } = await ownerWithGalleries();
    const { website: notMine } = await ownerWithGalleries();
    const gallery = await createGallery(notMine);

    const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}/status`).send({
      status: 'draft',
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, GALLERY_NOT_FOUND);
  });
});

describe('DELETE /api/siteOwner/galleries/:id', () => {
  it('stamps deletedAt, keeps the rows, records it and revalidates the website', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, { images: [storedImage(website)] });

    const res = await as(owner, 'delete', `/api/siteOwner/galleries/${gallery.id}`);

    assert.equal(res.status, 204);
    const stored = await prisma.gallery.findUnique({ where: { id: gallery.id } });
    assert.ok(stored.deletedAt instanceof Date);
    assert.equal(await prisma.galleryImage.count({ where: { galleryId: gallery.id } }), 1);
    assert.deepEqual(await auditEvents(), [
      galleryEvent(owner, 'gallery.deleted', gallery.id, website.id),
    ]);
    assert.deepEqual(await revalidationBody(), { websiteId: website.id, galleryId: gallery.id });
  });

  it('leaves the ability as it was when a requested gallery is deleted', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'galleries');
    const gallery = await createGallery(website);
    await as(owner, 'post', `/api/siteOwner/galleries/${gallery.id}/request`).send({
      requestNote: 'The about page',
    });

    const res = await as(owner, 'delete', `/api/siteOwner/galleries/${gallery.id}`);

    assert.equal(res.status, 204);
    const stored = await prisma.websiteAbility.findUnique({ where: { id: ability.id } });
    assert.equal(stored.status, 'added');
    assert.equal(stored.updatedAt.getTime(), ability.updatedAt.getTime());
  });

  it('treats a deleted gallery as gone on every route', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website);
    const path = `/api/siteOwner/galleries/${gallery.id}`;
    await as(owner, 'delete', path);

    const responses = [
      await as(owner, 'get', path),
      await as(owner, 'patch', path).send(editGallery(website)),
      await as(owner, 'patch', `${path}/status`).send({ status: 'draft' }),
      await as(owner, 'delete', path),
    ];

    for (const res of responses) {
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, GALLERY_NOT_FOUND);
    }
  });

  it("returns 404 for another owner's gallery and leaves it", async () => {
    const { owner } = await ownerWithGalleries();
    const { website: notMine } = await ownerWithGalleries();
    const gallery = await createGallery(notMine);

    const res = await as(owner, 'delete', `/api/siteOwner/galleries/${gallery.id}`);

    assert.equal(res.status, 404);
    const stored = await prisma.gallery.findUnique({ where: { id: gallery.id } });
    assert.equal(stored.deletedAt, null);
  });
});

describe('POST /api/siteOwner/galleries/:id/request', () => {
  it("saves the note, puts the gallery's placement to requested, and leaves the ability", async () => {
    for (const status of ['added', 'live']) {
      await resetState();
      const { owner, website } = await createOwnerWithWebsite();
      const ability = await createAbility(website, 'galleries', { status });
      const gallery = await createGallery(website);

      const res = await as(owner, 'post', `/api/siteOwner/galleries/${gallery.id}/request`).send({
        requestNote: '  On the Portfolio page,\nbelow the intro.  ',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.id, gallery.id);
      assert.equal(res.body.data.placement, 'requested');
      assert.equal(res.body.data.requestNote, 'On the Portfolio page,\nbelow the intro.');
      assert.ok(res.body.data.requestedAt);
      const stored = await prisma.websiteAbility.findUnique({ where: { id: ability.id } });
      assert.equal(stored.status, status);
      assert.equal(stored.placement, null);
      assert.equal(stored.requestedAt, null);
      const events = await auditEvents();
      assert.deepEqual(events, [galleryEvent(owner, 'gallery.requested', gallery.id, website.id)]);
      assert.ok(!JSON.stringify(events).includes('Portfolio'));
    }
  });

  it('returns 409 when the gallery has already been requested', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, { requestedAt: new Date() });

    const res = await as(owner, 'post', `/api/siteOwner/galleries/${gallery.id}/request`).send({
      requestNote: 'Here',
    });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      error: { message: 'This gallery has already been requested.' },
    });
  });

  it('returns 400 on fields.requestNote for a blank note and one over 1000 characters', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website);
    const path = `/api/siteOwner/galleries/${gallery.id}/request`;

    const blank = await as(owner, 'post', path).send({ requestNote: '   ' });
    const long = await as(owner, 'post', path).send({ requestNote: 'a'.repeat(1001) });

    assert.equal(blank.status, 400);
    assert.deepEqual(blank.body.error.fields, { requestNote: 'Request note is required.' });
    assert.deepEqual(long.body.error.fields, {
      requestNote: 'Request note must be 1000 characters or fewer.',
    });
  });

  it("returns 404 for another owner's gallery, a deleted one or an unknown id", async () => {
    const { owner, website } = await ownerWithGalleries();
    const { website: notMine } = await ownerWithGalleries();
    const theirs = await createGallery(notMine);
    const deleted = await createGallery(website, { deletedAt: new Date() });

    for (const id of [theirs.id, deleted.id, UNKNOWN_ID]) {
      const res = await as(owner, 'post', `/api/siteOwner/galleries/${id}/request`).send({
        requestNote: 'Here',
      });

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, GALLERY_NOT_FOUND);
    }
  });
});

describe('PATCH /api/siteOwner/galleries/:id/request', () => {
  it('replaces the note and puts a live gallery back to requested, leaving the ability', async () => {
    const lastRequest = new Date(Date.now() - 60 * 60 * 1000);
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'galleries', { status: 'live' });
    const gallery = await createGallery(website, {
      requestNote: 'On the home page',
      requestedAt: lastRequest,
      placement: 'live',
    });

    const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}/request`).send({
      requestNote: 'On the Portfolio page',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.placement, 'requested');
    assert.equal(res.body.data.requestNote, 'On the Portfolio page');
    assert.ok(new Date(res.body.data.requestedAt) > lastRequest);
    const stored = await prisma.websiteAbility.findUnique({ where: { id: ability.id } });
    assert.equal(stored.status, 'live');
    const events = await auditEvents();
    assert.deepEqual(events, [
      galleryEvent(owner, 'gallery.request_updated', gallery.id, website.id),
    ]);
    assert.ok(!JSON.stringify(events).includes('Portfolio'));
  });

  it('gives a note to a gallery backfilled without one', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, { requestedAt: new Date() });

    const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}/request`).send({
      requestNote: 'Here',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.requestNote, 'Here');
  });

  it("returns 409 when the gallery's message hasn't been sent yet", async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website);

    const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}/request`).send({
      requestNote: 'Here',
    });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: { message: "This gallery hasn't been requested yet." } });
  });

  it('returns 400 on fields.requestNote for a blank note', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, { requestedAt: new Date() });

    const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}/request`).send({
      requestNote: ' ',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, { requestNote: 'Request note is required.' });
  });

  it("returns 404 for another owner's gallery or a deleted one", async () => {
    const { owner, website } = await ownerWithGalleries();
    const { website: notMine } = await ownerWithGalleries();
    const theirs = await createGallery(notMine, { requestedAt: new Date() });
    const deleted = await createGallery(website, {
      requestedAt: new Date(),
      deletedAt: new Date(),
    });

    for (const id of [theirs.id, deleted.id]) {
      const res = await as(owner, 'patch', `/api/siteOwner/galleries/${id}/request`).send({
        requestNote: 'Here',
      });

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, GALLERY_NOT_FOUND);
    }
  });
});

describe('gallery request emails', () => {
  it("emails the admin, naming the gallery, after its message is sent and after it's edited", async (t) => {
    process.env.RESEND_API_KEY = 're_test_key';
    t.after(() => delete process.env.RESEND_API_KEY);
    await createAdmin({ email: 'rich@example.com' });
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, { galleryName: 'Our Interior' });
    const path = `/api/siteOwner/galleries/${gallery.id}/request`;

    await as(owner, 'post', path).send({ requestNote: 'On the home page' });
    await waitFor(() => assert.equal(fetchMock.mock.callCount(), 1));
    await as(owner, 'patch', path).send({ requestNote: 'On the Portfolio page' });
    await waitFor(() => assert.equal(fetchMock.mock.callCount(), 2));

    const [first, second] = fetchMock.mock.calls.map((call) => JSON.parse(call.arguments[1].body));
    assert.deepEqual(first.to, ['rich@example.com']);
    assert.equal(first.reply_to, owner.email);
    assert.match(first.subject, /^New request: Photo Galleries "Our Interior" on /);
    assert.match(first.text, /On the home page/);
    assert.match(second.subject, /^Updated request: Photo Galleries "Our Interior" on /);
    assert.match(second.text, /On the Portfolio page/);
  });
});

describe('gallery go-live date (publishAt)', () => {
  const inADay = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
  const publishAtError = (message) => ({
    error: { message: 'Please fix the highlighted fields.', fields: { publishAt: message } },
  });

  it('creates a draft with a go-live date and returns it on the Gallery and its summary', async () => {
    const { owner, website } = await ownerWithGalleries();
    const publishAt = inADay();

    const res = await as(owner, 'post', '/api/siteOwner/galleries').send(
      newGallery(website, { status: 'draft', publishAt: publishAt.toISOString() }),
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.publishAt, publishAt.toISOString());
    const websites = await as(owner, 'get', '/api/siteOwner/websites');
    assert.equal(websites.body.data[0].galleries[0].publishAt, publishAt.toISOString());
  });

  it('returns 400 for a go-live date on a published gallery, the default status', async () => {
    const { owner, website } = await ownerWithGalleries();

    const res = await as(owner, 'post', '/api/siteOwner/galleries').send(
      newGallery(website, { publishAt: inADay().toISOString() }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, publishAtError('Only a draft can have a go-live date.'));
    assert.equal(await prisma.gallery.count(), 0);
  });

  it('sets and clears the go-live date on edit, and leaves it when not sent', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, { status: 'draft' });
    const publishAt = inADay().toISOString();
    const path = `/api/siteOwner/galleries/${gallery.id}`;

    const set = await as(owner, 'patch', path).send(editGallery(website, { publishAt }));
    const kept = await as(owner, 'patch', path).send(editGallery(website));
    const cleared = await as(owner, 'patch', path).send(editGallery(website, { publishAt: null }));

    assert.equal(set.body.data.publishAt, publishAt);
    assert.equal(kept.body.data.publishAt, publishAt);
    assert.equal(cleared.body.data.publishAt, null);
  });

  it('returns 400 for a go-live date on a published gallery on edit', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website);

    const res = await as(owner, 'patch', `/api/siteOwner/galleries/${gallery.id}`).send(
      editGallery(website, { publishAt: inADay().toISOString() }),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, publishAtError('Only a draft can have a go-live date.'));
  });

  it('clears the go-live date when the gallery is published by hand or deleted', async () => {
    const { owner, website } = await ownerWithGalleries();
    const published = await createGallery(website, { status: 'draft', publishAt: inADay() });
    const deleted = await createGallery(website, { status: 'draft', publishAt: inADay() });

    const res = await as(owner, 'patch', `/api/siteOwner/galleries/${published.id}/status`).send({
      status: 'published',
    });
    await as(owner, 'delete', `/api/siteOwner/galleries/${deleted.id}`);

    assert.equal(res.body.data.publishAt, null);
    const stored = await prisma.gallery.findUniqueOrThrow({ where: { id: deleted.id } });
    assert.ok(stored.deletedAt);
    assert.equal(stored.publishAt, null);
  });
});

describe('gallery publishedAt (when it went live)', () => {
  it('stamps it when a draft gallery is published and clears it on draft', async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, { status: 'draft' });
    const path = `/api/siteOwner/galleries/${gallery.id}/status`;

    const published = await as(owner, 'patch', path).send({ status: 'published' });
    const drafted = await as(owner, 'patch', path).send({ status: 'draft' });

    assert.ok(published.body.data.publishedAt);
    assert.equal(drafted.body.data.publishedAt, null);
  });
});

describe('PATCH /api/siteOwner/galleries/:id/publishAt', () => {
  it("sets and clears a draft gallery's go-live date and records gallery.updated", async () => {
    const { owner, website } = await ownerWithGalleries();
    const gallery = await createGallery(website, { status: 'draft' });
    const path = `/api/siteOwner/galleries/${gallery.id}/publishAt`;
    const publishAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const set = await as(owner, 'patch', path).send({ publishAt });
    const cleared = await as(owner, 'patch', path).send({ publishAt: null });

    assert.equal(set.status, 200);
    assert.equal(set.body.data.publishAt, publishAt);
    assert.equal(cleared.body.data.publishAt, null);
    assert.deepEqual(await auditEvents(), [
      galleryEvent(owner, 'gallery.updated', gallery.id, website.id),
      galleryEvent(owner, 'gallery.updated', gallery.id, website.id),
    ]);
  });

  it('returns 400 for a go-live date on a published gallery, and 404 for one not owned', async () => {
    const { owner, website } = await ownerWithGalleries();
    const published = await createGallery(website);
    const { website: theirs } = await ownerWithGalleries();
    const notMine = await createGallery(theirs, { status: 'draft' });
    const body = { publishAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };

    const bad = await as(owner, 'patch', `/api/siteOwner/galleries/${published.id}/publishAt`).send(
      body,
    );
    const missing = await as(
      owner,
      'patch',
      `/api/siteOwner/galleries/${notMine.id}/publishAt`,
    ).send(body);

    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.error.fields, { publishAt: 'Only a draft can have a go-live date.' });
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: { message: 'Gallery not found.' } });
  });
});
