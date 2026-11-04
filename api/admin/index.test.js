// Request tests for the admin routes (api/admin/index.js).
require('../../testing/setup');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../app');
const prisma = require('../../prisma');
const { hashApiKey, decryptSecret } = require('../../lib/crypto');
const {
  CSRF,
  resetState,
  disconnect,
  createAdmin,
  createSiteOwner,
  createWebsite,
  createAbility,
  createPost,
  paragraph,
  linkWebsite,
  createGallery,
  imageSrc,
  sessionCookie,
  assertNoSecrets,
  auditEvents,
  createAuditEvent,
} = require('../../testing/helpers');

const VALIDATION_FAILED = 'Please fix the highlighted fields.';
const URL_TAKEN = 'A website with this URL already exists. Select it from the dropdown.';

beforeEach(resetState);
after(disconnect);

// Sends a request as the given account. Writes carry the CSRF header.
function as(account, method, path) {
  const req = request(app)[method](path).set('Cookie', sessionCookie(account));
  return method === 'get' ? req : req.set(CSRF);
}

// The audit events an administrator's change writes, as audit_event rows return them.
function adminEvent(admin, action, targetType, targetId, metadata = null) {
  return { action, actorId: admin.id, actorEmail: admin.email, targetType, targetId, metadata };
}

// The state a new website's posts ability is added with, as its audit event's metadata holds it.
function postsAddedMetadata(website) {
  return {
    websiteId: website.id,
    kind: 'posts',
    status: 'added',
    turnedOn: true,
    placement: null,
    removed: false,
  };
}

async function rowCounts() {
  const [accounts, websites, links] = await Promise.all([
    prisma.account.count(),
    prisma.website.count(),
    prisma.accountWebsite.count(),
  ]);
  return { accounts, websites, links };
}

describe('admin route guards', () => {
  const routes = [
    ['get', '/api/admin/accounts'],
    ['get', '/api/admin/websites'],
    ['post', '/api/admin/accounts'],
    ['post', '/api/admin/accounts/some-id/websites'],
    ['get', '/api/admin/auditEvents'],
    ['get', '/api/admin/auditEvents/months'],
    ['patch', '/api/admin/abilities/some-id/status'],
    ['patch', '/api/admin/galleries/some-id/placement'],
  ];

  for (const [method, path] of routes) {
    it(`returns 401 for ${method.toUpperCase()} ${path} without a session`, async () => {
      const res = await request(app)[method](path).set(CSRF);

      assert.equal(res.status, 401);
      assert.deepEqual(res.body, {
        error: { message: 'Your session expired, please sign in again.' },
      });
    });

    it(`returns 403 for ${method.toUpperCase()} ${path} as a site owner`, async () => {
      const owner = await createSiteOwner();

      const res = await as(owner, method, path);

      assert.equal(res.status, 403);
      assert.deepEqual(res.body, { error: { message: 'You do not have access to this page.' } });
    });
  }
});

describe('GET /api/admin/accounts', () => {
  it('returns every site owner, active and inactive, sorted by name, with their websites', async () => {
    const admin = await createAdmin();
    const zoe = await createSiteOwner({ name: 'Zoe', email: 'zoe@example.com', active: false });
    const amy = await createSiteOwner({ name: 'Amy', email: 'amy@example.com' });
    const { website: beta } = await createWebsite({ websiteName: 'Beta' });
    const { website: alpha } = await createWebsite({ websiteName: 'Alpha', active: false });
    await linkWebsite(amy, beta);
    await linkWebsite(amy, alpha);

    const res = await as(admin, 'get', '/api/admin/accounts');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: [
        {
          id: amy.id,
          name: 'Amy',
          email: 'amy@example.com',
          role: 'site_owner',
          active: true,
          createdAt: amy.createdAt.toISOString(),
          websites: [
            {
              id: alpha.id,
              websiteName: 'Alpha',
              url: alpha.url,
              active: false,
              abilities: [],
              posts: [],
              galleries: [],
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
        },
        {
          id: zoe.id,
          name: 'Zoe',
          email: 'zoe@example.com',
          role: 'site_owner',
          active: false,
          createdAt: zoe.createdAt.toISOString(),
          websites: [],
        },
      ],
    });
    await assertNoSecrets(res.body);
  });

  it("returns each website's galleries, not deleted, newest first, with a crop flag only when every image has that crop", async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const { website } = await createWebsite();
    await linkWebsite(owner, website);
    const image = (name, crops = {}) => ({
      src: imageSrc(website, name),
      width: 1200,
      height: 800,
      altText: 'A',
      caption: 'A caption',
      ...crops,
    });
    const crops = {
      thumbnailX: 0,
      thumbnailY: 0,
      thumbnailWidth: 800,
      thumbnailHeight: 800,
      mobileX: 0,
      mobileY: 0,
      mobileWidth: 400,
      mobileHeight: 800,
    };
    const cropped = await createGallery(website, {
      galleryName: 'Cropped',
      requestNote: 'The portfolio page',
      requestedAt: new Date(),
      placement: 'requested',
      title: 'A title',
      copy: 'Some copy',
      images: [image('a', crops), image('b', crops), image('c', crops)],
    });
    const mixed = await createGallery(website, {
      galleryName: 'Mixed',
      images: [image('m1', crops), image('m2')],
    });
    await createGallery(website, { galleryName: 'Deleted', deletedAt: new Date() });
    const plain = await createGallery(website, {
      galleryName: 'Plain',
      status: 'draft',
      images: [image('d')],
    });

    const res = await as(admin, 'get', '/api/admin/accounts');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data[0].websites[0].galleries, [
      {
        id: plain.id,
        galleryName: 'Plain',
        status: 'draft',
        placement: null,
        requestNote: null,
        imageCount: 1,
        hasThumbnails: false,
        hasMobileCrops: false,
      },
      {
        id: mixed.id,
        galleryName: 'Mixed',
        status: 'published',
        placement: null,
        requestNote: null,
        imageCount: 2,
        hasThumbnails: false,
        hasMobileCrops: false,
      },
      {
        id: cropped.id,
        galleryName: 'Cropped',
        status: 'published',
        placement: 'requested',
        requestNote: 'The portfolio page',
        imageCount: 3,
        hasThumbnails: true,
        hasMobileCrops: true,
      },
    ]);
  });
});

describe('GET /api/admin/websites', () => {
  it('returns only active websites, sorted by name, with no secrets', async () => {
    const admin = await createAdmin();
    const { website: beta } = await createWebsite({ websiteName: 'Beta' });
    const { website: alpha } = await createWebsite({ websiteName: 'Alpha' });
    await createWebsite({ websiteName: 'Archived', active: false });

    const res = await as(admin, 'get', '/api/admin/websites');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: [
        { id: alpha.id, websiteName: 'Alpha', url: alpha.url, active: true },
        { id: beta.id, websiteName: 'Beta', url: beta.url, active: true },
      ],
    });
    await assertNoSecrets(res.body);
  });
});

describe('POST /api/admin/accounts', () => {
  it('creates an account linked to an existing website, without credentials', async () => {
    const admin = await createAdmin();
    const { website } = await createWebsite({ websiteName: 'Stevie The Dog' });

    const res = await as(admin, 'post', '/api/admin/accounts').send({
      name: '  Rich  ',
      email: '  Rich@Example.COM ',
      websiteId: website.id,
    });

    assert.equal(res.status, 201);
    const { account } = res.body.data;
    assert.deepEqual(res.body.data, {
      account: {
        id: account.id,
        name: 'Rich',
        email: 'rich@example.com',
        role: 'site_owner',
        active: true,
        createdAt: account.createdAt,
      },
      website: { id: website.id, websiteName: 'Stevie The Dog', url: website.url, active: true },
    });
    const link = await prisma.accountWebsite.findFirst({ where: { accountId: account.id } });
    assert.equal(link.websiteId, website.id);
    await assertNoSecrets(res.body);
  });

  it('creates an account with a new website and returns its credentials once', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'post', '/api/admin/accounts').send({
      name: 'Rich',
      email: 'rich@example.com',
      websiteName: 'Stevie The Dog',
      websiteUrl: 'https://WWW.SteviTheDog.com/',
    });

    assert.equal(res.status, 201);
    const { account, website, credentials } = res.body.data;
    assert.deepEqual(website, {
      id: website.id,
      websiteName: 'Stevie The Dog',
      url: 'https://www.stevithedog.com',
      active: true,
    });
    assert.deepEqual(Object.keys(credentials).sort(), ['apiKey', 'webhookSecret']);
    const stored = await prisma.website.findUnique({ where: { id: website.id } });
    assert.equal(stored.apiKeyHash, hashApiKey(credentials.apiKey));
    assert.equal(decryptSecret(stored.webhookSecretEncrypted), credentials.webhookSecret);
    assert.equal(stored.mediaFolder, 'stevithedog');
    const link = await prisma.accountWebsite.findFirst({ where: { accountId: account.id } });
    assert.equal(link.websiteId, website.id);
    await assertNoSecrets(res.body);
  });

  it('records the new account and its link to an existing website in the audit log', async () => {
    const admin = await createAdmin();
    const { website } = await createWebsite();

    const res = await as(admin, 'post', '/api/admin/accounts').send({
      name: 'Rich',
      email: 'rich@example.com',
      websiteId: website.id,
    });

    const accountId = res.body.data.account.id;
    assert.deepEqual(await auditEvents(), [
      adminEvent(admin, 'account.created', 'account', accountId, { websiteId: website.id }),
      adminEvent(admin, 'website.linked', 'account', accountId, { websiteId: website.id }),
    ]);
  });

  it('records the new website, its posts ability, account and link in the audit log, without credentials', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'post', '/api/admin/accounts').send({
      name: 'Rich',
      email: 'rich@example.com',
      websiteName: 'Stevie The Dog',
      websiteUrl: 'https://www.steviethedog.com',
    });

    const { account, website, credentials } = res.body.data;
    const posts = await prisma.websiteAbility.findFirst({ where: { websiteId: website.id } });
    const events = await auditEvents();
    assert.deepEqual(events, [
      adminEvent(admin, 'website.created', 'website', website.id),
      adminEvent(admin, 'ability.added', 'ability', posts.id, postsAddedMetadata(website)),
      adminEvent(admin, 'account.created', 'account', account.id, { websiteId: website.id }),
      adminEvent(admin, 'website.linked', 'account', account.id, { websiteId: website.id }),
    ]);
    const text = JSON.stringify(events);
    assert.ok(!text.includes(credentials.apiKey) && !text.includes(credentials.webhookSecret));
    await assertNoSecrets(events);
  });

  it('returns 400 with a message per field for a blank name, a bad email and an http URL', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'post', '/api/admin/accounts').send({
      name: '   ',
      email: 'not-an-email',
      websiteName: 'Stevie',
      websiteUrl: 'http://www.steviethedog.com',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: VALIDATION_FAILED,
        fields: {
          name: 'Name is required.',
          email: 'Enter a valid email address.',
          websiteUrl: 'Must be a valid URL starting with https://',
        },
      },
    });
    assert.deepEqual(await rowCounts(), { accounts: 1, websites: 0, links: 0 });
  });

  it('returns 409 when an account with the email already exists', async () => {
    const admin = await createAdmin();
    await createSiteOwner({ email: 'rich@example.com' });
    const { website } = await createWebsite();

    const res = await as(admin, 'post', '/api/admin/accounts').send({
      name: 'Rich',
      email: 'RICH@example.com',
      websiteId: website.id,
    });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      error: { message: 'An account with this email already exists.' },
    });
    assert.deepEqual(await rowCounts(), { accounts: 2, websites: 1, links: 0 });
  });

  it('returns 409 when the new website URL already exists, ignoring www.', async () => {
    const admin = await createAdmin();
    await createWebsite({ url: 'https://steviethedog.com' });

    const res = await as(admin, 'post', '/api/admin/accounts').send({
      name: 'Rich',
      email: 'rich@example.com',
      websiteName: 'Stevie',
      websiteUrl: 'https://www.steviethedog.com',
    });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: { message: URL_TAKEN } });
    assert.deepEqual(await rowCounts(), { accounts: 1, websites: 1, links: 0 });
  });

  it('returns 409 naming the website when the URL belongs to an inactive website', async () => {
    const admin = await createAdmin();
    await createWebsite({
      websiteName: 'Old Stevie',
      url: 'https://www.steviethedog.com',
      active: false,
    });

    const res = await as(admin, 'post', '/api/admin/accounts').send({
      name: 'Rich',
      email: 'rich@example.com',
      websiteName: 'Stevie',
      websiteUrl: 'https://www.steviethedog.com',
    });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      error: {
        message:
          "A website with this URL already exists but is inactive. It's named Old Stevie. Reactivate and then try again.",
      },
    });
  });

  it('returns 404 for an unknown website id', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'post', '/api/admin/accounts').send({
      name: 'Rich',
      email: 'rich@example.com',
      websiteId: '019a0000-0000-7000-8000-000000000000',
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: { message: 'Website not found.' } });
    assert.deepEqual(await rowCounts(), { accounts: 1, websites: 0, links: 0 });
  });

  it('returns 404 for an inactive website id', async () => {
    const admin = await createAdmin();
    const { website } = await createWebsite({ active: false });

    const res = await as(admin, 'post', '/api/admin/accounts').send({
      name: 'Rich',
      email: 'rich@example.com',
      websiteId: website.id,
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: { message: 'Website not found.' } });
  });
});

describe('POST /api/admin/accounts/:id/websites', () => {
  it('links an existing website to the account, without credentials', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const { website } = await createWebsite({ websiteName: 'Second Site' });

    const res = await as(admin, 'post', `/api/admin/accounts/${owner.id}/websites`).send({
      websiteId: website.id,
    });

    assert.equal(res.status, 201);
    assert.deepEqual(res.body, {
      data: {
        website: { id: website.id, websiteName: 'Second Site', url: website.url, active: true },
      },
    });
    const link = await prisma.accountWebsite.findFirst({ where: { accountId: owner.id } });
    assert.equal(link.websiteId, website.id);
  });

  it('creates and links a new website and returns its credentials', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();

    const res = await as(admin, 'post', `/api/admin/accounts/${owner.id}/websites`).send({
      websiteName: 'Second Site',
      websiteUrl: 'https://Second.example.com//',
    });

    assert.equal(res.status, 201);
    const { website, credentials } = res.body.data;
    assert.equal(website.url, 'https://second.example.com');
    const stored = await prisma.website.findUnique({ where: { id: website.id } });
    assert.equal(stored.apiKeyHash, hashApiKey(credentials.apiKey));
    assert.equal(decryptSecret(stored.webhookSecretEncrypted), credentials.webhookSecret);
    const link = await prisma.accountWebsite.findFirst({ where: { accountId: owner.id } });
    assert.equal(link.websiteId, website.id);
    await assertNoSecrets(res.body);
  });

  it('records linking an existing website in the audit log', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const { website } = await createWebsite();

    await as(admin, 'post', `/api/admin/accounts/${owner.id}/websites`).send({
      websiteId: website.id,
    });

    assert.deepEqual(await auditEvents(), [
      adminEvent(admin, 'website.linked', 'account', owner.id, { websiteId: website.id }),
    ]);
  });

  it('records the new website, its posts ability and its link in the audit log', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();

    const res = await as(admin, 'post', `/api/admin/accounts/${owner.id}/websites`).send({
      websiteName: 'Second Site',
      websiteUrl: 'https://second.example.com',
    });

    const { website } = res.body.data;
    const posts = await prisma.websiteAbility.findFirst({ where: { websiteId: website.id } });
    assert.deepEqual(await auditEvents(), [
      adminEvent(admin, 'website.created', 'website', website.id),
      adminEvent(admin, 'ability.added', 'ability', posts.id, postsAddedMetadata(website)),
      adminEvent(admin, 'website.linked', 'account', owner.id, { websiteId: website.id }),
    ]);
  });

  it('gives the new website the next free media folder when its name is taken', async () => {
    const admin = await createAdmin();
    const account = await createSiteOwner();
    await createWebsite({ url: 'https://www.example.com', mediaFolder: 'example' });
    await createWebsite({ url: 'https://example.net', mediaFolder: 'example-2' });

    const res = await as(admin, 'post', `/api/admin/accounts/${account.id}/websites`).send({
      websiteName: 'Example Shop',
      websiteUrl: 'https://example.org',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.website.mediaFolder, undefined);
    const stored = await prisma.website.findUnique({ where: { id: res.body.data.website.id } });
    assert.equal(stored.mediaFolder, 'example-3');
  });

  it('returns 404 for an unknown account, before validating the body', async () => {
    const admin = await createAdmin();

    const res = await as(
      admin,
      'post',
      '/api/admin/accounts/019a0000-0000-7000-8000-000000000000/websites',
    ).send({});

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: { message: 'Account not found.' } });
  });

  it("returns 404 for the administrator's own account", async () => {
    const admin = await createAdmin();
    const { website } = await createWebsite();

    const res = await as(admin, 'post', `/api/admin/accounts/${admin.id}/websites`).send({
      websiteId: website.id,
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: { message: 'Account not found.' } });
    assert.equal(await prisma.accountWebsite.count(), 0);
  });

  it('returns 400 when the website name is missing on the new website path', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();

    const res = await as(admin, 'post', `/api/admin/accounts/${owner.id}/websites`).send({
      websiteUrl: 'https://second.example.com',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: { message: VALIDATION_FAILED, fields: { websiteName: 'Website name is required.' } },
    });
  });

  it('returns 409 when the account is already linked to the website', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const { website } = await createWebsite({ websiteName: 'Stevie The Dog' });
    await linkWebsite(owner, website);

    const res = await as(admin, 'post', `/api/admin/accounts/${owner.id}/websites`).send({
      websiteId: website.id,
    });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      error: { message: 'This account is already linked to Stevie The Dog.' },
    });
  });

  it('returns 404 for an inactive website', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const { website } = await createWebsite({ active: false });

    const res = await as(admin, 'post', `/api/admin/accounts/${owner.id}/websites`).send({
      websiteId: website.id,
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: { message: 'Website not found.' } });
  });

  it('returns 409 when the new website URL already exists', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    await createWebsite({ url: 'https://www.second.example.com' });

    const res = await as(admin, 'post', `/api/admin/accounts/${owner.id}/websites`).send({
      websiteName: 'Second Site',
      websiteUrl: 'https://second.example.com',
    });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: { message: URL_TAKEN } });
    assert.equal(await prisma.website.count(), 1);
  });
});

describe('GET /api/admin/auditEvents', () => {
  const AUDIT_EVENT_FIELDS = [
    'action',
    'actorEmail',
    'createdAt',
    'id',
    'ip',
    'metadata',
    'targetId',
    'targetType',
  ];

  it("returns the current month's events newest first, without actorId", async () => {
    const admin = await createAdmin();
    const older = await createAuditEvent({ actorId: admin.id, targetType: 'post', targetId: 'p1' });
    const newer = await createAuditEvent({ action: 'auth.logout', metadata: { websiteId: 'w1' } });

    const res = await as(admin, 'get', '/api/admin/auditEvents');

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map((event) => event.id),
      [newer.id, older.id],
    );
    assert.deepEqual(Object.keys(res.body.data[1]).sort(), AUDIT_EVENT_FIELDS);
    assert.deepEqual(res.body.data[1], {
      id: older.id,
      action: 'auth.login_succeeded',
      actorEmail: 'admin@example.com',
      targetType: 'post',
      targetId: 'p1',
      metadata: null,
      ip: '203.0.113.1',
      createdAt: older.createdAt.toISOString(),
    });
    assert.deepEqual(res.body.data[0].metadata, { websiteId: 'w1' });
    assert.equal(res.body.nextCursor, null);
  });

  it('returns only the requested month, bounded in UTC', async () => {
    const admin = await createAdmin();
    await createAuditEvent({ createdAt: new Date('2026-09-30T23:59:59.999Z') });
    const first = await createAuditEvent({ createdAt: new Date('2026-10-01T00:00:00.000Z') });
    const last = await createAuditEvent({ createdAt: new Date('2026-10-31T23:59:59.999Z') });
    await createAuditEvent({ createdAt: new Date('2026-11-01T00:00:00.000Z') });

    const res = await as(admin, 'get', '/api/admin/auditEvents?month=2026-10');

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map((event) => event.id),
      [last.id, first.id],
    );
  });

  it('returns an empty list for a month with no events', async () => {
    const admin = await createAdmin();
    await createAuditEvent();

    const res = await as(admin, 'get', '/api/admin/auditEvents?month=2020-01');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: [], nextCursor: null });
  });

  it('pages through a month with limit and the returned cursor', async () => {
    const admin = await createAdmin();
    const first = await createAuditEvent();
    const second = await createAuditEvent();
    const third = await createAuditEvent();

    const page1 = await as(admin, 'get', '/api/admin/auditEvents?limit=2');
    const page2 = await as(
      admin,
      'get',
      `/api/admin/auditEvents?limit=2&cursor=${page1.body.nextCursor}`,
    );

    assert.deepEqual(
      page1.body.data.map((event) => event.id),
      [third.id, second.id],
    );
    assert.equal(page1.body.nextCursor, second.id);
    assert.deepEqual(
      page2.body.data.map((event) => event.id),
      [first.id],
    );
    assert.equal(page2.body.nextCursor, null);
  });

  it('returns 50 events per page by default', async () => {
    const admin = await createAdmin();
    for (let i = 0; i < 51; i += 1) await createAuditEvent();

    const res = await as(admin, 'get', '/api/admin/auditEvents');

    assert.equal(res.body.data.length, 50);
    assert.equal(res.body.nextCursor, res.body.data[49].id);
  });

  const invalidQueries = [
    ['month=2026-13', 'month', 'Enter a month as YYYY-MM.'],
    ['month=2026-1', 'month', 'Enter a month as YYYY-MM.'],
    ['month=2026-10&month=2026-11', 'month', 'Enter a month as YYYY-MM.'],
    ['limit=0', 'limit', 'Limit must be a whole number from 1 to 100.'],
    ['limit=101', 'limit', 'Limit must be a whole number from 1 to 100.'],
    ['limit=1.5', 'limit', 'Limit must be a whole number from 1 to 100.'],
    ['limit=abc', 'limit', 'Limit must be a whole number from 1 to 100.'],
    ['cursor=not-a-uuid', 'cursor', 'Invalid cursor.'],
  ];

  for (const [query, field, message] of invalidQueries) {
    it(`returns 400 on ${field} for ?${query}`, async () => {
      const admin = await createAdmin();

      const res = await as(admin, 'get', `/api/admin/auditEvents?${query}`);

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, {
        error: { message: VALIDATION_FAILED, fields: { [field]: message } },
      });
    });
  }

  it('writes no audit event of its own', async () => {
    const admin = await createAdmin();

    await as(admin, 'get', '/api/admin/auditEvents');

    assert.deepEqual(await auditEvents(), []);
  });
});

describe('GET /api/admin/auditEvents/months', () => {
  it('returns each month with events once, newest first', async () => {
    const admin = await createAdmin();
    await createAuditEvent({ createdAt: new Date('2026-09-15T12:00:00.000Z') });
    await createAuditEvent({ createdAt: new Date('2026-10-02T12:00:00.000Z') });
    await createAuditEvent({ createdAt: new Date('2026-10-20T12:00:00.000Z') });
    await createAuditEvent({ createdAt: new Date('2026-12-01T12:00:00.000Z') });

    const res = await as(admin, 'get', '/api/admin/auditEvents/months');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: ['2026-12', '2026-10', '2026-09'] });
  });

  it('places events in their UTC month', async () => {
    const admin = await createAdmin();
    await createAuditEvent({ createdAt: new Date('2026-10-31T23:59:59.999Z') });
    await createAuditEvent({ createdAt: new Date('2026-11-01T00:00:00.000Z') });

    const res = await as(admin, 'get', '/api/admin/auditEvents/months');

    assert.deepEqual(res.body, { data: ['2026-11', '2026-10'] });
  });

  it('returns an empty list when there are no events', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'get', '/api/admin/auditEvents/months');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: [] });
  });

  it('writes no audit event of its own', async () => {
    const admin = await createAdmin();

    await as(admin, 'get', '/api/admin/auditEvents/months');

    assert.deepEqual(await auditEvents(), []);
  });
});

// An ability event's metadata: the ability's whole state after the change.
function abilityState(ability, state) {
  return {
    websiteId: ability.websiteId,
    kind: ability.kind,
    status: 'live',
    turnedOn: true,
    placement: null,
    removed: false,
    ...state,
  };
}

describe('PATCH /api/admin/abilities/:id/status', () => {
  it('sets Photo Galleries live from added, with no request, and records it with its state', async () => {
    const admin = await createAdmin();
    const { website } = await createWebsite();
    const ability = await createAbility(website, 'galleries');

    const res = await as(admin, 'patch', `/api/admin/abilities/${ability.id}/status`).send({
      status: 'live',
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, {
      id: ability.id,
      kind: 'galleries',
      status: 'live',
      turnedOn: true,
      placement: null,
      requestNote: null,
      requestedAt: null,
      createdAt: ability.createdAt.toISOString(),
      updatedAt: res.body.data.updatedAt,
    });
    assert.deepEqual(await auditEvents(), [
      adminEvent(admin, 'ability.live', 'ability', ability.id, abilityState(ability)),
    ]);
  });

  it('sets requested posts live and places them with one switch', async () => {
    const admin = await createAdmin();
    const { website } = await createWebsite();
    const added = await createAbility(website, 'posts', {
      placement: 'requested',
      requestNote: 'A blog page',
      requestedAt: new Date('2026-11-01T00:00:00.000Z'),
    });
    const { website: other } = await createWebsite();
    const moving = await createAbility(other, 'posts', {
      status: 'live',
      turnedOn: false,
      placement: 'requested',
      requestedAt: new Date(),
    });

    for (const [ability, turnedOn] of [
      [added, true],
      [moving, false],
    ]) {
      const res = await as(admin, 'patch', `/api/admin/abilities/${ability.id}/status`).send({
        status: 'live',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'live');
      assert.equal(res.body.data.placement, 'live');
      assert.equal(res.body.data.turnedOn, turnedOn);
    }
    assert.deepEqual(await auditEvents(), [
      adminEvent(
        admin,
        'ability.live',
        'ability',
        added.id,
        abilityState(added, { placement: 'live' }),
      ),
      adminEvent(
        admin,
        'ability.live',
        'ability',
        moving.id,
        abilityState(moving, { placement: 'live', turnedOn: false }),
      ),
    ]);
  });

  it('returns 409 for posts not yet requested, posts already live, or Photo Galleries already live', async () => {
    const admin = await createAdmin();
    const { website } = await createWebsite();
    const notRequested = await createAbility(website, 'posts');
    const { website: other } = await createWebsite();
    const livePosts = await createAbility(other, 'posts', { status: 'live', placement: 'live' });
    const liveGalleries = await createAbility(website, 'galleries', { status: 'live' });

    const send = (ability) =>
      as(admin, 'patch', `/api/admin/abilities/${ability.id}/status`).send({ status: 'live' });
    const responses = [await send(notRequested), await send(livePosts), await send(liveGalleries)];

    assert.deepEqual(
      responses.map((res) => [res.status, res.body.error.message]),
      [
        [409, "This ability hasn't been requested yet."],
        [409, 'This ability is already live.'],
        [409, 'This ability is already live.'],
      ],
    );
    assert.deepEqual(await auditEvents(), []);
  });

  it('returns 404 for a removed or unknown ability', async () => {
    const admin = await createAdmin();
    const { website } = await createWebsite();
    const removed = await createAbility(website, 'galleries', { removedAt: new Date() });

    for (const id of [removed.id, '019a0000-0000-7000-8000-000000000000']) {
      const res = await as(admin, 'patch', `/api/admin/abilities/${id}/status`).send({
        status: 'live',
      });

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: { message: 'Ability not found.' } });
    }
  });

  it('returns 400 on fields.status for any status but live', async () => {
    const admin = await createAdmin();
    const { website } = await createWebsite();
    const ability = await createAbility(website, 'galleries');

    const res = await as(admin, 'patch', `/api/admin/abilities/${ability.id}/status`).send({
      status: 'added',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: { message: VALIDATION_FAILED, fields: { status: 'Status must be live.' } },
    });
  });
});

describe('PATCH /api/admin/galleries/:id/placement', () => {
  // A website whose Photo Galleries ability has the given status, with one gallery.
  async function websiteWithGallery(abilityStatus, galleryFields = {}) {
    const { website } = await createWebsite();
    await createAbility(website, 'galleries', { status: abilityStatus });
    const gallery = await createGallery(website, {
      galleryName: 'Art',
      requestNote: 'The portfolio page',
      requestedAt: new Date(),
      placement: 'requested',
      ...galleryFields,
    });
    return { website, gallery };
  }

  function placementPath(gallery) {
    return `/api/admin/galleries/${gallery.id}/placement`;
  }

  it('sets a requested gallery live, returns its summary and records it', async () => {
    const admin = await createAdmin();
    const { website, gallery } = await websiteWithGallery('live');

    const res = await as(admin, 'patch', placementPath(gallery)).send({ placement: 'live' });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, {
      id: gallery.id,
      galleryName: 'Art',
      status: 'published',
      placement: 'live',
      requestNote: 'The portfolio page',
      imageCount: 0,
      hasThumbnails: false,
      hasMobileCrops: false,
    });
    assert.deepEqual(await auditEvents(), [
      adminEvent(admin, 'gallery.live', 'gallery', gallery.id, { websiteId: website.id }),
    ]);
  });

  it('returns 409 before Photo Galleries is live, before the request, and once live', async () => {
    const admin = await createAdmin();
    const { gallery: abilityNotLive } = await websiteWithGallery('added');
    const { gallery: notRequested } = await websiteWithGallery('live', {
      requestNote: null,
      requestedAt: null,
      placement: null,
    });
    const { gallery: alreadyLive } = await websiteWithGallery('live', { placement: 'live' });

    const responses = [];
    for (const gallery of [abilityNotLive, notRequested, alreadyLive]) {
      responses.push(await as(admin, 'patch', placementPath(gallery)).send({ placement: 'live' }));
    }

    assert.deepEqual(
      responses.map((res) => [res.status, res.body.error.message]),
      [
        [409, 'Set Photo Galleries live first.'],
        [409, "This gallery hasn't been requested yet."],
        [409, 'This gallery is already live.'],
      ],
    );
    assert.deepEqual(await auditEvents(), []);
  });

  it("returns 409 when the gallery's website has no Photo Galleries row at all", async () => {
    const admin = await createAdmin();
    const { website } = await createWebsite();
    const gallery = await createGallery(website, {
      requestedAt: new Date(),
      placement: 'requested',
    });

    const res = await as(admin, 'patch', placementPath(gallery)).send({ placement: 'live' });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: { message: 'Set Photo Galleries live first.' } });
  });

  it('returns 404 for a deleted or unknown gallery', async () => {
    const admin = await createAdmin();
    const { gallery } = await websiteWithGallery('live', { deletedAt: new Date() });

    for (const id of [gallery.id, '019a0000-0000-7000-8000-000000000000']) {
      const res = await as(admin, 'patch', `/api/admin/galleries/${id}/placement`).send({
        placement: 'live',
      });

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: { message: 'Gallery not found.' } });
    }
  });

  it('returns 400 on fields.placement for any placement but live', async () => {
    const admin = await createAdmin();
    const { gallery } = await websiteWithGallery('live');

    const res = await as(admin, 'patch', placementPath(gallery)).send({ placement: 'requested' });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: { message: VALIDATION_FAILED, fields: { placement: 'Placement must be live.' } },
    });
  });
});

describe('GET /api/admin/accounts abilities', () => {
  it("returns each website's abilities that aren't removed, with the request note", async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const { website } = await createWebsite();
    await linkWebsite(owner, website);
    const posts = await createAbility(website, 'posts', {
      placement: 'requested',
      requestNote: 'A blog page',
      requestedAt: new Date('2026-11-01T00:00:00.000Z'),
    });
    const { website: other } = await createWebsite();
    await linkWebsite(owner, other);
    await createAbility(other, 'galleries', { removedAt: new Date() });

    const res = await as(admin, 'get', '/api/admin/accounts');

    const [first, second] = res.body.data[0].websites;
    const withAbility = first.id === website.id ? first : second;
    const withRemoved = first.id === website.id ? second : first;
    assert.deepEqual(withAbility.abilities, [
      {
        id: posts.id,
        kind: 'posts',
        status: 'added',
        turnedOn: true,
        placement: 'requested',
        requestNote: 'A blog page',
        requestedAt: '2026-11-01T00:00:00.000Z',
        createdAt: posts.createdAt.toISOString(),
        updatedAt: posts.updatedAt.toISOString(),
      },
    ]);
    assert.deepEqual(withRemoved.abilities, []);
  });
});

describe('GET /api/admin/accounts posts', () => {
  it("returns each website's posts, not deleted, drafts included, newest first, as names and statuses only", async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const { website } = await createWebsite();
    await linkWebsite(owner, website);
    const older = await createPost(website, {
      postName: 'Older',
      status: 'draft',
      header: 'Private header',
      body: [paragraph('Private body words')],
    });
    const newer = await createPost(website, { postName: 'Newer' });
    await createPost(website, { postName: 'Deleted', deletedAt: new Date() });

    const res = await as(admin, 'get', '/api/admin/accounts');

    assert.deepEqual(res.body.data[0].websites[0].posts, [
      { id: newer.id, postName: 'Newer', status: 'published' },
      { id: older.id, postName: 'Older', status: 'draft' },
    ]);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('Private header') && !text.includes('Private body words'));
  });
});
