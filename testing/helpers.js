// Shared test helpers: the reset every test starts from, builders that write real rows to the test
// database, the session cookie and CSRF header a request needs, the no-secrets assertion, the
// audit log reader and builder, and mocks for the two external
// edges (Google ID-token verification and the outbound revalidation fetch).
const assert = require('node:assert/strict');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('../prisma');
const { SESSION_COOKIE, signSession } = require('../lib/jwt');
const { resetRateLimits } = require('../lib/rateLimit');
const {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  encryptSecret,
} = require('../lib/crypto');

const CSRF = { 'X-CSRF-Protection': '1' };

// Field names that must never appear in any response body.
const SECRET_FIELDS = [
  'apiKeyHash',
  'webhookSecretEncrypted',
  'api_key_hash',
  'webhook_secret_encrypted',
];

let sequence = 0;
// A value unique within the test run, for emails and URLs.
function unique() {
  sequence += 1;
  return sequence;
}

// Run in beforeEach: every test starts from an empty database and empty rate limit counts.
async function resetState() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE element, image, post, account_website, website, account, audit_event CASCADE',
  );
  await resetRateLimits();
}

// Run in each file's after hook, so the Prisma connection pool doesn't keep the process alive.
async function disconnect() {
  await prisma.$disconnect();
}

function createAdmin(overrides = {}) {
  return prisma.account.create({
    data: { name: 'Admin', email: `admin${unique()}@example.com`, role: 'admin', ...overrides },
  });
}

function createSiteOwner(overrides = {}) {
  return prisma.account.create({
    data: {
      name: 'Site Owner',
      email: `owner${unique()}@example.com`,
      role: 'site_owner',
      ...overrides,
    },
  });
}

// Creates a website with a real API key and webhook secret, returned in plaintext so tests can
// use the key and check the secret sent on revalidation.
async function createWebsite(overrides = {}) {
  const apiKey = generateApiKey();
  const webhookSecret = generateWebhookSecret();
  const website = await prisma.website.create({
    data: {
      websiteName: 'Website',
      url: `https://site${unique()}.example.com`,
      apiKeyHash: hashApiKey(apiKey),
      webhookSecretEncrypted: encryptSecret(webhookSecret),
      mediaFolder: `site${unique()}`,
      ...overrides,
    },
  });
  return { website, apiKey, webhookSecret };
}

function linkWebsite(account, website) {
  return prisma.accountWebsite.create({ data: { accountId: account.id, websiteId: website.id } });
}

// A Cloudinary secure_url in the website's upload folder (lib/cloudinary.js → isInFolder), the
// only kind of image src the post routes accept. `name` makes it distinct within a post.
function imageSrc(website, name = 'a') {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_FOLDER } = process.env;
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/v1760000000/${CLOUDINARY_FOLDER}/${website.mediaFolder}/${name}.jpg`;
}

// A paragraph element for createPost's body.
function paragraph(text = 'Body') {
  return { type: 'paragraph', text };
}

// An image element for createPost's body; `image` is { src, width, height, altText }.
function imageElement(image) {
  return { type: 'image', image };
}

// Creates a post with its body, inserted in list order, in one transaction. `body` is a list of
// paragraph() / imageElement() items. `status` sets the legacy active in step, as the routes do.
// Returns the post with its images (in body order).
function createPost(website, { body = [paragraph()], status = 'published', ...overrides } = {}) {
  return prisma.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        websiteId: website.id,
        postName: 'Post',
        status,
        active: status === 'published',
        ...overrides,
      },
    });
    const images = [];
    for (const [position, element] of body.entries()) {
      if (element.type === 'paragraph') {
        await tx.element.create({ data: { postId: post.id, position, ...element } });
        continue;
      }
      const image = await tx.image.create({ data: { ...element.image, postId: post.id } });
      await tx.element.create({
        data: { postId: post.id, position, type: 'image', imageId: image.id },
      });
      images.push(image);
    }
    return { ...post, images };
  });
}

// A site owner linked to an active website: the starting point of most site owner tests.
async function createOwnerWithWebsite(websiteOverrides = {}) {
  const owner = await createSiteOwner();
  const { website, apiKey, webhookSecret } = await createWebsite(websiteOverrides);
  await linkWebsite(owner, website);
  return { owner, website, apiKey, webhookSecret };
}

// The Cookie header for a signed-in account, built with the app's own signSession.
function sessionCookie(account) {
  return `${SESSION_COOKIE}=${signSession(account)}`;
}

// Fails if the body contains a secret field name or any stored hash / encrypted value.
async function assertNoSecrets(body) {
  const text = JSON.stringify(body);
  for (const field of SECRET_FIELDS) {
    assert.ok(!text.includes(field), `response contains ${field}`);
  }
  const websites = await prisma.website.findMany({
    select: { apiKeyHash: true, webhookSecretEncrypted: true },
  });
  for (const { apiKeyHash, webhookSecretEncrypted } of websites) {
    assert.ok(!text.includes(apiKeyHash), 'response contains an API key hash');
    assert.ok(!text.includes(webhookSecretEncrypted), 'response contains an encrypted secret');
  }
}

// Every audit event written so far, oldest first, without id, ip and createdAt.
function auditEvents() {
  return prisma.auditEvent.findMany({
    orderBy: { id: 'asc' },
    select: {
      action: true,
      actorId: true,
      actorEmail: true,
      targetType: true,
      targetId: true,
      metadata: true,
    },
  });
}

// Writes one audit event. Pass createdAt to place it in a month; ids follow insertion order, so
// a test inserts events oldest first.
function createAuditEvent(overrides = {}) {
  return prisma.auditEvent.create({
    data: {
      action: 'auth.login_succeeded',
      actorEmail: 'admin@example.com',
      ip: '203.0.113.1',
      ...overrides,
    },
  });
}

// Replaces Google's ID-token verification: resolves with a ticket carrying `payload`, or rejects
// with `error`. `tracker` is node:test's `mock` (or a test's `t.mock`), which restores it.
function mockGoogle(tracker, { payload, error }) {
  return tracker.method(OAuth2Client.prototype, 'verifyIdToken', async () => {
    if (error) throw error;
    return { getPayload: () => payload };
  });
}

// Replaces the global fetch (the revalidation call). `outcome` is a status code to respond with,
// an Error to reject with, or 'hang' for a call that never settles. `tracker` as in mockGoogle.
function mockFetch(tracker, outcome = 200) {
  return tracker.method(globalThis, 'fetch', async () => {
    if (outcome instanceof Error) throw outcome;
    if (outcome === 'hang') return new Promise(() => {});
    return new Response(null, { status: outcome });
  });
}

// Polls until `check` stops throwing, for fire-and-forget work like revalidation.
async function waitFor(check, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

module.exports = {
  CSRF,
  resetState,
  disconnect,
  createAdmin,
  createSiteOwner,
  createWebsite,
  linkWebsite,
  imageSrc,
  paragraph,
  imageElement,
  createPost,
  createOwnerWithWebsite,
  sessionCookie,
  assertNoSecrets,
  auditEvents,
  createAuditEvent,
  mockGoogle,
  mockFetch,
  waitFor,
};
