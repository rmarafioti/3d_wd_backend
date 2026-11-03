// Request tests for the site owner ability routes (api/siteOwner/abilities.js): add, request (and
// edit the request), turn on or off, and remove. Covers the role guard and CSRF, the ownership
// rule (another owner's, an inactive website's or a removed ability is a 404), validation, every
// 409, removing Photo Galleries (its galleries deleted with the ability's time) and adding it back
// (restored within 30 days, started again after), the audit events with the ability's full state,
// revalidation, and the admin's request email. fetch is mocked in every test.
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

const ABILITY_NOT_FOUND = { error: { message: 'Ability not found.' } };
const VALIDATION_FAILED = 'Please fix the highlighted fields.';
const UNKNOWN_ID = '019a0000-0000-7000-8000-000000000000';
const DAY_MS = 24 * 60 * 60 * 1000;

let fetchMock;

beforeEach(async () => {
  await resetState();
  fetchMock = mockFetch(mock);
});
afterEach(() => mock.restoreAll());
after(disconnect);

// Sends a request as the given account. Writes carry the CSRF header.
function as(account, method, path) {
  return request(app)[method](path).set('Cookie', sessionCookie(account)).set(CSRF);
}

// The audit event an ability change writes: its state after the change in metadata.
function abilityEvent(owner, action, ability, state) {
  return {
    action,
    actorId: owner.id,
    actorEmail: owner.email,
    targetType: 'ability',
    targetId: ability.id,
    metadata: {
      websiteId: ability.websiteId,
      kind: ability.kind,
      status: 'added',
      turnedOn: true,
      placement: null,
      removed: false,
      ...state,
    },
  };
}

function galleryEvent(owner, action, gallery) {
  return {
    action,
    actorId: owner.id,
    actorEmail: owner.email,
    targetType: 'gallery',
    targetId: gallery.id,
    metadata: { websiteId: gallery.websiteId },
  };
}

// Waits for the fire-and-forget revalidation call and returns the body it sent.
async function revalidationBody() {
  await waitFor(() => assert.equal(fetchMock.mock.callCount(), 1));
  const [, options] = fetchMock.mock.calls[0].arguments;
  return JSON.parse(options.body);
}

// Lets an unawaited revalidation start, so a test can check none was sent.
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('site owner ability route guards', () => {
  const routes = [
    ['post', '/api/siteOwner/abilities'],
    ['post', '/api/siteOwner/abilities/some-id/request'],
    ['patch', '/api/siteOwner/abilities/some-id/request'],
    ['patch', '/api/siteOwner/abilities/some-id/turnedOn'],
    ['delete', '/api/siteOwner/abilities/some-id'],
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
    const { owner, website } = await createOwnerWithWebsite();

    const res = await request(app)
      .post('/api/siteOwner/abilities')
      .set('Cookie', sessionCookie(owner))
      .send({ websiteId: website.id, kind: 'galleries' });

    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: { message: 'Request blocked.' } });
    assert.equal(await prisma.websiteAbility.count(), 0);
  });
});

describe('POST /api/siteOwner/abilities', () => {
  it('adds Photo Galleries, added and on, and records it', async () => {
    const { owner, website } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/abilities').send({
      websiteId: website.id,
      kind: 'galleries',
    });

    assert.equal(res.status, 201);
    const stored = await prisma.websiteAbility.findFirstOrThrow();
    assert.deepEqual(res.body, {
      data: {
        id: stored.id,
        kind: 'galleries',
        status: 'added',
        turnedOn: true,
        placement: null,
        requestNote: null,
        requestedAt: null,
        createdAt: stored.createdAt.toISOString(),
        updatedAt: stored.updatedAt.toISOString(),
      },
    });
    assert.deepEqual(await auditEvents(), [abilityEvent(owner, 'ability.added', stored)]);
    await assertNoSecrets(res.body);
    await settle();
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('returns 409 for an ability the website already has, posts included', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    await createAbility(website, 'posts');
    await createAbility(website, 'galleries', { status: 'live' });

    for (const kind of ['posts', 'galleries']) {
      const res = await as(owner, 'post', '/api/siteOwner/abilities').send({
        websiteId: website.id,
        kind,
      });

      assert.equal(res.status, 409);
      assert.deepEqual(res.body, { error: { message: 'This ability has already been added.' } });
    }
  });

  it("returns 404 for another owner's website or an inactive one", async () => {
    const { owner } = await createOwnerWithWebsite();
    const { website: notMine } = await createOwnerWithWebsite();
    const { website: inactive } = await createWebsite({ active: false });
    await linkWebsite(owner, inactive);

    for (const website of [notMine, inactive]) {
      const res = await as(owner, 'post', '/api/siteOwner/abilities').send({
        websiteId: website.id,
        kind: 'galleries',
      });

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: { message: 'Website not found.' } });
    }
    assert.equal(await prisma.websiteAbility.count(), 0);
  });

  it('returns 400 on fields for a missing website and an unknown kind', async () => {
    const { owner } = await createOwnerWithWebsite();

    const res = await as(owner, 'post', '/api/siteOwner/abilities').send({ kind: 'hours' });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: VALIDATION_FAILED,
        fields: { websiteId: 'Website is required.', kind: 'Choose posts or galleries.' },
      },
    });
  });

  it('restores, within 30 days, the galleries its removal deleted and the status it had', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const removedAt = new Date(Date.now() - 29 * DAY_MS);
    const ability = await createAbility(website, 'galleries', {
      status: 'live',
      turnedOn: false,
      requestNote: 'A gallery page',
      removedAt,
    });
    const removedWithIt = await createGallery(website, { deletedAt: removedAt });
    await createGallery(website, {
      deletedAt: new Date(removedAt.getTime() - 1000),
    });

    const res = await as(owner, 'post', '/api/siteOwner/abilities').send({
      websiteId: website.id,
      kind: 'galleries',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.id, ability.id);
    assert.equal(res.body.data.status, 'live');
    assert.equal(res.body.data.turnedOn, false);
    assert.equal(res.body.data.requestNote, 'A gallery page');
    const galleries = await prisma.gallery.findMany({ where: { deletedAt: null } });
    assert.deepEqual(
      galleries.map((gallery) => gallery.id),
      [removedWithIt.id],
    );
    assert.deepEqual(await auditEvents(), [
      galleryEvent(owner, 'gallery.restored', removedWithIt),
      abilityEvent(owner, 'ability.restored', ability, { status: 'live', turnedOn: false }),
    ]);
    assert.deepEqual(await revalidationBody(), { websiteId: website.id, ability: 'galleries' });
  });

  it('keeps its status and switch, and the galleries deleted, more than 30 days after removal', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const removedAt = new Date(Date.now() - 31 * DAY_MS);
    const ability = await createAbility(website, 'galleries', {
      status: 'live',
      turnedOn: false,
      removedAt,
    });
    await createGallery(website, { deletedAt: removedAt });

    const res = await as(owner, 'post', '/api/siteOwner/abilities').send({
      websiteId: website.id,
      kind: 'galleries',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.id, ability.id);
    assert.equal(res.body.data.status, 'live');
    assert.equal(res.body.data.turnedOn, false);
    assert.equal(await prisma.gallery.count({ where: { deletedAt: null } }), 0);
    assert.deepEqual(await auditEvents(), [
      abilityEvent(owner, 'ability.added', ability, { status: 'live', turnedOn: false }),
    ]);
  });
});

describe('POST /api/siteOwner/abilities/:id/request', () => {
  it("requests posts' placement with its note, keeping the status and the note out of the audit log", async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts');

    const res = await as(owner, 'post', `/api/siteOwner/abilities/${ability.id}/request`).send({
      requestNote: '  On the News page,\nunder the header.  ',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'added');
    assert.equal(res.body.data.placement, 'requested');
    assert.equal(res.body.data.requestNote, 'On the News page,\nunder the header.');
    assert.ok(res.body.data.requestedAt);
    const events = await auditEvents();
    assert.deepEqual(events, [
      abilityEvent(owner, 'ability.requested', ability, { placement: 'requested' }),
    ]);
    assert.ok(!JSON.stringify(events).includes('News page'));
  });

  it('returns 409 for posts already requested or live while a post from before remains', async () => {
    const lastRequest = new Date(Date.now() - DAY_MS);
    const requestedSite = await createOwnerWithWebsite();
    const requested = await createAbility(requestedSite.website, 'posts', {
      placement: 'requested',
      requestedAt: lastRequest,
    });
    const liveSite = await createOwnerWithWebsite();
    const live = await createAbility(liveSite.website, 'posts', {
      status: 'live',
      placement: 'live',
      requestedAt: lastRequest,
    });
    // The older post stays, so the newer one isn't a new first post.
    await createPost(liveSite.website, { createdAt: new Date(Date.now() - 2 * DAY_MS) });
    await createPost(liveSite.website);

    for (const [owner, ability] of [
      [requestedSite.owner, requested],
      [liveSite.owner, live],
    ]) {
      const res = await as(owner, 'post', `/api/siteOwner/abilities/${ability.id}/request`).send({
        requestNote: 'Here',
      });

      assert.equal(res.status, 409);
      assert.deepEqual(res.body, {
        error: { message: 'This ability has already been requested.' },
      });
    }
  });

  it('requests posts again after every post was deleted and a new first post saved', async () => {
    const lastRequest = new Date(Date.now() - DAY_MS);
    for (const placement of ['live', 'requested']) {
      const { owner, website } = await createOwnerWithWebsite();
      const ability = await createAbility(website, 'posts', {
        status: 'live',
        placement,
        requestNote: 'Old place',
        requestedAt: lastRequest,
      });
      await createPost(website, {
        createdAt: new Date(Date.now() - 2 * DAY_MS),
        deletedAt: new Date(),
      });
      await createPost(website);

      const res = await as(owner, 'post', `/api/siteOwner/abilities/${ability.id}/request`).send({
        requestNote: 'New place',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'live');
      assert.equal(res.body.data.placement, 'requested');
      assert.equal(res.body.data.requestNote, 'New place');
      assert.ok(new Date(res.body.data.requestedAt) > lastRequest);
    }
  });

  it('returns 409 for a Photo Galleries ability, requested per gallery instead', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'galleries');

    const res = await as(owner, 'post', `/api/siteOwner/abilities/${ability.id}/request`).send({
      requestNote: 'Here',
    });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      error: { message: 'Photo Galleries are requested one gallery at a time.' },
    });
  });

  it('returns 400 on fields.requestNote for a blank note and one over 1000 characters', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts');
    const path = `/api/siteOwner/abilities/${ability.id}/request`;

    const blank = await as(owner, 'post', path).send({ requestNote: '   ' });
    const long = await as(owner, 'post', path).send({ requestNote: 'a'.repeat(1001) });
    const atLimit = await as(owner, 'post', path).send({ requestNote: 'a'.repeat(1000) });

    assert.deepEqual(blank.body.error.fields, { requestNote: 'Request note is required.' });
    assert.deepEqual(long.body.error.fields, {
      requestNote: 'Request note must be 1000 characters or fewer.',
    });
    assert.equal(atLimit.status, 200);
  });

  it("returns 404 for another owner's ability, a removed one or an unknown id", async () => {
    const { owner } = await createOwnerWithWebsite();
    const { website: notMine } = await createOwnerWithWebsite();
    const theirs = await createAbility(notMine, 'posts');
    const { website } = await createWebsite();
    await linkWebsite(owner, website);
    const removed = await createAbility(website, 'galleries', { removedAt: new Date() });

    for (const id of [theirs.id, removed.id, UNKNOWN_ID]) {
      const res = await as(owner, 'post', `/api/siteOwner/abilities/${id}/request`).send({
        requestNote: 'Here',
      });

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, ABILITY_NOT_FOUND);
    }
  });
});

describe('PATCH /api/siteOwner/abilities/:id/request', () => {
  it('replaces the note of live posts and puts their placement back to requested, recording the edit', async () => {
    const lastRequest = new Date(Date.now() - DAY_MS);
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts', {
      status: 'live',
      placement: 'live',
      requestNote: 'On the home page',
      requestedAt: lastRequest,
    });

    const res = await as(owner, 'patch', `/api/siteOwner/abilities/${ability.id}/request`).send({
      requestNote: 'On the News page',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'live');
    assert.equal(res.body.data.placement, 'requested');
    assert.equal(res.body.data.requestNote, 'On the News page');
    assert.ok(new Date(res.body.data.requestedAt) > lastRequest);
    const events = await auditEvents();
    assert.deepEqual(events, [
      abilityEvent(owner, 'ability.request_updated', ability, {
        status: 'live',
        placement: 'requested',
      }),
    ]);
    assert.ok(!JSON.stringify(events).includes('News page'));
  });

  it('edits a note that is still requested', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts', {
      placement: 'requested',
      requestNote: 'Old place',
      requestedAt: new Date(),
    });

    const res = await as(owner, 'patch', `/api/siteOwner/abilities/${ability.id}/request`).send({
      requestNote: 'New place',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.requestNote, 'New place');
  });

  it('returns 409 for posts not requested yet and for a Photo Galleries ability', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const posts = await createAbility(website, 'posts');
    const galleries = await createAbility(website, 'galleries', { status: 'live' });

    const notYet = await as(owner, 'patch', `/api/siteOwner/abilities/${posts.id}/request`).send({
      requestNote: 'Here',
    });
    const perGallery = await as(
      owner,
      'patch',
      `/api/siteOwner/abilities/${galleries.id}/request`,
    ).send({ requestNote: 'Here' });

    assert.equal(notYet.status, 409);
    assert.deepEqual(notYet.body, {
      error: { message: "This ability hasn't been requested yet." },
    });
    assert.equal(perGallery.status, 409);
    assert.deepEqual(perGallery.body, {
      error: { message: 'Photo Galleries are requested one gallery at a time.' },
    });
  });

  it('returns 400 on fields.requestNote for a blank note', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts', {
      status: 'live',
      requestNote: 'Here',
      requestedAt: new Date(),
    });

    const res = await as(owner, 'patch', `/api/siteOwner/abilities/${ability.id}/request`).send({
      requestNote: ' ',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, { requestNote: 'Request note is required.' });
  });

  it("returns 404 for another owner's ability", async () => {
    const { owner } = await createOwnerWithWebsite();
    const { website: notMine } = await createOwnerWithWebsite();
    const theirs = await createAbility(notMine, 'posts', {
      status: 'live',
      requestNote: 'Here',
      requestedAt: new Date(),
    });

    const res = await as(owner, 'patch', `/api/siteOwner/abilities/${theirs.id}/request`).send({
      requestNote: 'Mine now',
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, ABILITY_NOT_FOUND);
  });
});

describe('posts request emails', () => {
  it('emails the admin after the request form is sent and again after it is edited', async (t) => {
    process.env.RESEND_API_KEY = 're_test_key';
    t.after(() => delete process.env.RESEND_API_KEY);
    await createAdmin({ email: 'rich@example.com' });
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts');
    const path = `/api/siteOwner/abilities/${ability.id}/request`;

    const sent = await as(owner, 'post', path).send({ requestNote: 'On the News page' });
    await waitFor(() => assert.equal(fetchMock.mock.callCount(), 1));
    const edited = await as(owner, 'patch', path).send({ requestNote: 'On the About page' });
    await waitFor(() => assert.equal(fetchMock.mock.callCount(), 2));

    assert.equal(sent.status, 200);
    assert.equal(edited.status, 200);
    const [first, second] = fetchMock.mock.calls.map((call) => {
      const [url, options] = call.arguments;
      return { url, body: JSON.parse(options.body) };
    });
    assert.equal(first.url, 'https://api.resend.com/emails');
    assert.deepEqual(first.body.to, ['rich@example.com']);
    assert.equal(first.body.reply_to, owner.email);
    assert.match(first.body.subject, /^New request: Posts on /);
    assert.match(first.body.text, /On the News page/);
    assert.match(second.body.subject, /^Updated request: Posts on /);
    assert.match(second.body.text, /On the About page/);
  });

  it('answers the site owner normally when the email fails', async (t) => {
    process.env.RESEND_API_KEY = 're_test_key';
    t.after(() => delete process.env.RESEND_API_KEY);
    t.mock.method(console, 'error', () => {});
    mock.restoreAll();
    fetchMock = mockFetch(mock, new TypeError('fetch failed'));
    await createAdmin();
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts');

    const res = await as(owner, 'post', `/api/siteOwner/abilities/${ability.id}/request`).send({
      requestNote: 'Here',
    });
    await waitFor(() => assert.equal(fetchMock.mock.callCount(), 1));

    assert.equal(res.status, 200);
    assert.equal(res.body.data.placement, 'requested');
  });
});

describe('PATCH /api/siteOwner/abilities/:id/turnedOn', () => {
  it('turns a live ability off, records it and revalidates the website', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts', { status: 'live' });

    const res = await as(owner, 'patch', `/api/siteOwner/abilities/${ability.id}/turnedOn`).send({
      turnedOn: false,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.turnedOn, false);
    assert.deepEqual(await auditEvents(), [
      abilityEvent(owner, 'ability.turned_off', ability, { status: 'live', turnedOn: false }),
    ]);
    assert.deepEqual(await revalidationBody(), { websiteId: website.id, ability: 'posts' });
  });

  it('turns it back on', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts', { status: 'live', turnedOn: false });

    const res = await as(owner, 'patch', `/api/siteOwner/abilities/${ability.id}/turnedOn`).send({
      turnedOn: true,
    });

    assert.equal(res.body.data.turnedOn, true);
    assert.deepEqual(await auditEvents(), [
      abilityEvent(owner, 'ability.turned_on', ability, { status: 'live' }),
    ]);
  });

  it('changes nothing, with no event or revalidation, when already as asked', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts', { status: 'live' });

    const res = await as(owner, 'patch', `/api/siteOwner/abilities/${ability.id}/turnedOn`).send({
      turnedOn: true,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.turnedOn, true);
    assert.deepEqual(await auditEvents(), []);
    await settle();
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('returns 409 before the ability is live', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts', { placement: 'requested' });

    const res = await as(owner, 'patch', `/api/siteOwner/abilities/${ability.id}/turnedOn`).send({
      turnedOn: false,
    });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      error: { message: 'This ability can be turned on or off once it is live.' },
    });
  });

  it('returns 400 on fields.turnedOn for a value that is not a boolean', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts', { status: 'live' });

    const res = await as(owner, 'patch', `/api/siteOwner/abilities/${ability.id}/turnedOn`).send({
      turnedOn: 'no',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, { turnedOn: 'Turned on must be true or false.' });
  });

  it("returns 404 for another owner's ability", async () => {
    const { owner } = await createOwnerWithWebsite();
    const { website: notMine } = await createOwnerWithWebsite();
    const theirs = await createAbility(notMine, 'posts', { status: 'live' });

    const res = await as(owner, 'patch', `/api/siteOwner/abilities/${theirs.id}/turnedOn`).send({
      turnedOn: false,
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, ABILITY_NOT_FOUND);
  });
});

describe('DELETE /api/siteOwner/abilities/:id', () => {
  it("removes Photo Galleries, deleting the website's galleries with the same time", async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'galleries', { status: 'live' });
    const gallery = await createGallery(website);
    const { website: other } = await createWebsite();
    const otherGallery = await createGallery(other);

    const res = await as(owner, 'delete', `/api/siteOwner/abilities/${ability.id}`);

    assert.equal(res.status, 204);
    const stored = await prisma.websiteAbility.findUniqueOrThrow({ where: { id: ability.id } });
    const deleted = await prisma.gallery.findUniqueOrThrow({ where: { id: gallery.id } });
    assert.ok(stored.removedAt);
    assert.equal(deleted.deletedAt.getTime(), stored.removedAt.getTime());
    const untouched = await prisma.gallery.findUniqueOrThrow({ where: { id: otherGallery.id } });
    assert.equal(untouched.deletedAt, null);
    assert.deepEqual(await auditEvents(), [
      galleryEvent(owner, 'gallery.deleted', gallery),
      abilityEvent(owner, 'ability.removed', ability, { status: 'live', removed: true }),
    ]);
    assert.deepEqual(await revalidationBody(), { websiteId: website.id, ability: 'galleries' });
  });

  it('returns 409 for posts, which every website keeps', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const ability = await createAbility(website, 'posts', { status: 'live' });

    const res = await as(owner, 'delete', `/api/siteOwner/abilities/${ability.id}`);

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: { message: "Posts can't be removed." } });
  });

  it("returns 404 for another owner's ability or one already removed", async () => {
    const { owner, website } = await createOwnerWithWebsite();
    const removed = await createAbility(website, 'galleries', { removedAt: new Date() });
    const { website: notMine } = await createOwnerWithWebsite();
    const theirs = await createAbility(notMine, 'galleries');

    for (const id of [removed.id, theirs.id]) {
      const res = await as(owner, 'delete', `/api/siteOwner/abilities/${id}`);

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, ABILITY_NOT_FOUND);
    }
  });
});
