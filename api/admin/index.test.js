// Request tests for the admin routes (api/admin/index.js): the account list, the website picker,
// Create an Account and Link a Website. Covers the role guard, every documented 400/404/409,
// credentials only on a new website, the audit events each change writes, and that no secret
// ever reaches a response.
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
  linkWebsite,
  sessionCookie,
  assertNoSecrets,
  auditEvents,
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
            { id: alpha.id, websiteName: 'Alpha', url: alpha.url, active: false },
            { id: beta.id, websiteName: 'Beta', url: beta.url, active: true },
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

  it('records the new website, account and link in the audit log, without credentials', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'post', '/api/admin/accounts').send({
      name: 'Rich',
      email: 'rich@example.com',
      websiteName: 'Stevie The Dog',
      websiteUrl: 'https://www.steviethedog.com',
    });

    const { account, website, credentials } = res.body.data;
    const events = await auditEvents();
    assert.deepEqual(events, [
      adminEvent(admin, 'website.created', 'website', website.id),
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

  it('records the new website and its link in the audit log', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();

    const res = await as(admin, 'post', `/api/admin/accounts/${owner.id}/websites`).send({
      websiteName: 'Second Site',
      websiteUrl: 'https://second.example.com',
    });

    const { website } = res.body.data;
    assert.deepEqual(await auditEvents(), [
      adminEvent(admin, 'website.created', 'website', website.id),
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
