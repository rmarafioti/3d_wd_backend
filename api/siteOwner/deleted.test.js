// Request tests for the site owner's Recently Deleted routes (api/siteOwner/deleted.js): the list,
// bulk delete and bulk restore.
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
  createSiteOwner,
  createPost,
  createGallery,
  createAbility,
  createOwnerWithWebsite,
  createNotification,
  createThread,
  sessionCookie,
  assertNoSecrets,
  auditEvents,
  imageSrc,
  mockFetch,
  waitFor,
} = require('../../testing/helpers');

const DAY_MS = 24 * 60 * 60 * 1000;

const UNKNOWN_ID = '019a0000-0000-7000-8000-000000000000';

let fetchMock;

// Restoring a post or gallery revalidates its website, so every test mocks fetch.
beforeEach(async () => {
  await resetState();
  fetchMock = mockFetch(mock);
});
afterEach(() => mock.restoreAll());
after(disconnect);

function post(account, path) {
  return request(app).post(path).set('Cookie', sessionCookie(account)).set(CSRF);
}

// The audit event of a site owner's change to one item.
function event(account, action, targetType, targetId, metadata = null) {
  return { action, actorId: account.id, actorEmail: account.email, targetType, targetId, metadata };
}

function get(account, path) {
  return request(app).get(path).set('Cookie', sessionCookie(account));
}

function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS);
}

// An update sent to `owner` and deleted by them at `deletedAt`.
async function createDeletedUpdate(admin, owner, deletedAt, overrides = {}) {
  const notification = await createNotification(admin, [owner], overrides);
  await prisma.notificationRecipient.updateMany({
    where: { notificationId: notification.id, accountId: owner.id },
    data: { deletedAt },
  });
  return notification;
}

function expectedItem(type, id, name, deletedAt, website = null) {
  return {
    type,
    id,
    name,
    websiteId: website?.id ?? null,
    websiteName: website?.websiteName ?? null,
    deletedAt: deletedAt.toISOString(),
    restorableUntil: new Date(deletedAt.getTime() + 30 * DAY_MS).toISOString(),
  };
}

describe('GET /api/siteOwner/deleted', () => {
  it('lists deleted posts, galleries, updates and threads together, newest deletion first', async () => {
    const admin = await createAdmin();
    const { owner, website } = await createOwnerWithWebsite();
    await createAbility(website, 'galleries');
    const post = await createPost(website, { postName: 'Old post', deletedAt: daysAgo(4) });
    const gallery = await createGallery(website, {
      galleryName: 'Interior',
      deletedAt: daysAgo(3),
    });
    const updateDeletedAt = daysAgo(2);
    const update = await createDeletedUpdate(admin, owner, updateDeletedAt, { title: 'News' });
    const thread = await createThread(owner, { subject: 'Hours', ownerDeletedAt: daysAgo(1) });

    const res = await get(owner, '/api/siteOwner/deleted');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: [
        expectedItem('thread', thread.id, 'Hours', thread.ownerDeletedAt),
        expectedItem('update', update.id, 'News', updateDeletedAt),
        expectedItem('gallery', gallery.id, 'Interior', gallery.deletedAt, website),
        expectedItem('post', post.id, 'Old post', post.deletedAt, website),
      ],
      nextCursor: null,
    });
    await assertNoSecrets(res.body);
  });

  it("leaves out what isn't in this site owner's Recently Deleted", async () => {
    const admin = await createAdmin();
    const { owner, website } = await createOwnerWithWebsite();
    const { owner: other, website: otherWebsite } = await createOwnerWithWebsite();
    await createAbility(website, 'galleries', { removedAt: daysAgo(1) });
    await createPost(website, { postName: 'Kept' });
    await createPost(website, { deletedAt: daysAgo(30.01) });
    await createPost(otherWebsite, { deletedAt: daysAgo(1) });
    await createGallery(website, { deletedAt: daysAgo(1) });
    await createDeletedUpdate(admin, owner, daysAgo(1), { deletedAt: new Date() });
    await createDeletedUpdate(admin, other, daysAgo(1));
    await createThread(owner, { adminDeletedAt: daysAgo(1) });
    await createThread(other, { ownerDeletedAt: daysAgo(1) });
    const { owner: inactiveOwner, website: inactive } = await createOwnerWithWebsite({
      active: false,
    });
    await createPost(inactive, { deletedAt: daysAgo(1) });

    for (const account of [owner, inactiveOwner]) {
      const res = await get(account, '/api/siteOwner/deleted');

      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { data: [], nextCursor: null });
    }
  });

  it('pages across types with limit and cursor', async () => {
    const admin = await createAdmin();
    const { owner, website } = await createOwnerWithWebsite();
    const post = await createPost(website, { deletedAt: daysAgo(4) });
    const update = await createDeletedUpdate(admin, owner, daysAgo(3));
    const older = await createThread(owner, { ownerDeletedAt: daysAgo(2) });
    const newer = await createThread(owner, { ownerDeletedAt: daysAgo(1) });

    const first = await get(owner, '/api/siteOwner/deleted?limit=3');
    const second = await get(
      owner,
      `/api/siteOwner/deleted?limit=3&cursor=${first.body.nextCursor}`,
    );

    assert.deepEqual(
      first.body.data.map((item) => item.id),
      [newer.id, older.id, update.id],
    );
    assert.equal(first.body.nextCursor, update.id);
    assert.deepEqual(
      second.body.data.map((item) => item.id),
      [post.id],
    );
    assert.equal(second.body.nextCursor, null);
  });

  it('orders items deleted at the same moment by id, and pages through them', async () => {
    const owner = await createSiteOwner();
    const now = new Date();
    const threads = [];
    for (let i = 0; i < 3; i += 1) {
      threads.push(await createThread(owner, { ownerDeletedAt: now }));
    }
    const newestFirst = threads.map((thread) => thread.id).reverse();

    const first = await get(owner, '/api/siteOwner/deleted?limit=2');
    const second = await get(
      owner,
      `/api/siteOwner/deleted?limit=2&cursor=${first.body.nextCursor}`,
    );

    assert.deepEqual(
      [...first.body.data, ...second.body.data].map((item) => item.id),
      newestFirst,
    );
    assert.equal(second.body.nextCursor, null);
  });

  it('returns an empty last page when the cursor item was restored', async () => {
    const owner = await createSiteOwner();
    await createThread(owner, { ownerDeletedAt: daysAgo(2) });
    const cursorThread = await createThread(owner, { ownerDeletedAt: daysAgo(1) });
    await prisma.thread.update({ where: { id: cursorThread.id }, data: { ownerDeletedAt: null } });

    const res = await get(owner, `/api/siteOwner/deleted?cursor=${cursorThread.id}`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: [], nextCursor: null });
  });

  it('returns 400 for a bad cursor or limit', async () => {
    const owner = await createSiteOwner();

    const res = await get(owner, '/api/siteOwner/deleted?cursor=abc&limit=0');

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: {
          cursor: 'Invalid cursor.',
          limit: 'Limit must be a whole number from 1 to 100.',
        },
      },
    });
  });
});

describe('POST /api/siteOwner/deleted', () => {
  it("moves updates and threads from this site owner's mailbox only, in one request", async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const other = await createSiteOwner();
    const update = await createNotification(admin, [owner, other]);
    const thread = await createThread(owner);

    const res = await post(owner, '/api/siteOwner/deleted').send({
      items: [
        { type: 'update', id: update.id },
        { type: 'thread', id: thread.id },
      ],
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: {
        deleted: [
          { type: 'update', id: update.id },
          { type: 'thread', id: thread.id },
        ],
        failed: [],
      },
    });
    const recipients = await prisma.notificationRecipient.findMany({
      orderBy: { accountId: 'asc' },
    });
    const byAccount = Object.fromEntries(recipients.map((r) => [r.accountId, r.deletedAt]));
    assert.ok(byAccount[owner.id] instanceof Date);
    assert.equal(byAccount[other.id], null);
    const stored = await prisma.thread.findUnique({ where: { id: thread.id } });
    assert.ok(stored.ownerDeletedAt instanceof Date);
    assert.equal(stored.adminDeletedAt, null);
    const adminList = await request(app)
      .get('/api/admin/threads')
      .set('Cookie', sessionCookie(admin));
    assert.equal(adminList.body.data.length, 1);
    assert.deepEqual(await auditEvents(), [
      event(owner, 'notification.deleted', 'notification', update.id),
      event(owner, 'thread.deleted', 'thread', thread.id),
    ]);
    const deleted = await get(owner, '/api/siteOwner/deleted');
    assert.equal(deleted.body.data.length, 2);
  });

  it('reports items not in the mailbox in failed and still moves the rest', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const other = await createSiteOwner();
    const mine = await createThread(owner);
    const alreadyDeleted = await createThread(owner, { ownerDeletedAt: new Date() });
    const notMine = await createThread(other);
    const withdrawn = await createNotification(admin, [owner], { deletedAt: new Date() });

    const res = await post(owner, '/api/siteOwner/deleted').send({
      items: [
        { type: 'thread', id: notMine.id },
        { type: 'thread', id: mine.id },
        { type: 'thread', id: alreadyDeleted.id },
        { type: 'update', id: withdrawn.id },
        { type: 'update', id: UNKNOWN_ID },
      ],
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: {
        deleted: [{ type: 'thread', id: mine.id }],
        failed: [
          { type: 'thread', id: notMine.id, message: 'Thread not found.' },
          { type: 'thread', id: alreadyDeleted.id, message: 'Thread not found.' },
          { type: 'update', id: withdrawn.id, message: 'Update not found.' },
          { type: 'update', id: UNKNOWN_ID, message: 'Update not found.' },
        ],
      },
    });
    const stored = await prisma.thread.findUnique({ where: { id: notMine.id } });
    assert.equal(stored.ownerDeletedAt, null);
    assert.deepEqual(await auditEvents(), [event(owner, 'thread.deleted', 'thread', mine.id)]);
  });

  it('handles an item sent twice once', async () => {
    const owner = await createSiteOwner();
    const thread = await createThread(owner);
    const item = { type: 'thread', id: thread.id };

    const res = await post(owner, '/api/siteOwner/deleted').send({ items: [item, item] });

    assert.deepEqual(res.body, { data: { deleted: [item], failed: [] } });
    assert.equal((await auditEvents()).length, 1);
  });

  it('returns 400 for no items, too many, a type other than mail, or a bad id', async () => {
    const owner = await createSiteOwner();
    const tooMany = Array.from({ length: 101 }, () => ({ type: 'thread', id: UNKNOWN_ID }));
    const cases = [
      [{}, { items: 'Choose at least one item.' }],
      [{ items: [] }, { items: 'Choose at least one item.' }],
      [{ items: tooMany }, { items: 'Choose at most 100 items.' }],
      [
        {
          items: [
            { type: 'post', id: UNKNOWN_ID },
            { type: 'thread', id: 'abc' },
          ],
        },
        { 'items.0.type': 'Type must be update or thread.', 'items.1.id': 'Invalid id.' },
      ],
    ];

    for (const [body, fields] of cases) {
      const res = await post(owner, '/api/siteOwner/deleted').send(body);

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, {
        error: { message: 'Please fix the highlighted fields.', fields },
      });
    }
  });

  it('returns 403 without the CSRF header', async () => {
    const owner = await createSiteOwner();

    const res = await request(app)
      .post('/api/siteOwner/deleted')
      .set('Cookie', sessionCookie(owner))
      .send({ items: [{ type: 'thread', id: UNKNOWN_ID }] });

    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: { message: 'Request blocked.' } });
  });
});

describe('POST /api/siteOwner/deleted/restore', () => {
  it('restores a post, a gallery, an update and a thread as they were, with their events', async () => {
    const admin = await createAdmin();
    const { owner, website } = await createOwnerWithWebsite();
    await createAbility(website, 'galleries');
    const deletedPost = await createPost(website, { status: 'draft', deletedAt: daysAgo(1) });
    const gallery = await createGallery(website, {
      placement: 'live',
      deletedAt: daysAgo(2),
      images: [{ src: imageSrc(website), width: 10, height: 10, altText: 'A' }],
    });
    const readAt = daysAgo(3);
    const update = await createDeletedUpdate(admin, owner, daysAgo(1));
    await prisma.notificationRecipient.updateMany({
      where: { notificationId: update.id },
      data: { readAt },
    });
    const thread = await createThread(owner, { ownerDeletedAt: daysAgo(1) });
    const items = [
      { type: 'post', id: deletedPost.id },
      { type: 'gallery', id: gallery.id },
      { type: 'update', id: update.id },
      { type: 'thread', id: thread.id },
    ];

    const res = await post(owner, '/api/siteOwner/deleted/restore').send({ items });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: { restored: items, failed: [] } });
    const storedPost = await prisma.post.findUnique({ where: { id: deletedPost.id } });
    assert.equal(storedPost.deletedAt, null);
    assert.equal(storedPost.status, 'draft');
    const storedGallery = await prisma.gallery.findUnique({ where: { id: gallery.id } });
    assert.equal(storedGallery.deletedAt, null);
    assert.equal(storedGallery.placement, 'live');
    assert.equal(await prisma.galleryImage.count({ where: { galleryId: gallery.id } }), 1);
    const recipient = await prisma.notificationRecipient.findFirst({
      where: { notificationId: update.id },
    });
    assert.equal(recipient.deletedAt, null);
    assert.equal(recipient.readAt.getTime(), readAt.getTime());
    const storedThread = await prisma.thread.findUnique({ where: { id: thread.id } });
    assert.equal(storedThread.ownerDeletedAt, null);
    assert.deepEqual(await auditEvents(), [
      event(owner, 'post.restored', 'post', deletedPost.id, { websiteId: website.id }),
      event(owner, 'gallery.restored', 'gallery', gallery.id, { websiteId: website.id }),
      event(owner, 'notification.restored', 'notification', update.id),
      event(owner, 'thread.restored', 'thread', thread.id),
    ]);
    const deleted = await get(owner, '/api/siteOwner/deleted');
    assert.deepEqual(deleted.body.data, []);
  });

  it('revalidates each website once, after restoring its posts and galleries', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    await createAbility(website, 'galleries');
    const first = await createPost(website, { deletedAt: daysAgo(1) });
    const second = await createPost(website, { deletedAt: daysAgo(1) });
    const gallery = await createGallery(website, { deletedAt: daysAgo(1) });

    await post(owner, '/api/siteOwner/deleted/restore').send({
      items: [
        { type: 'post', id: first.id },
        { type: 'post', id: second.id },
        { type: 'gallery', id: gallery.id },
      ],
    });

    await waitFor(() => assert.equal(fetchMock.mock.callCount(), 1));
    const [, options] = fetchMock.mock.calls[0].arguments;
    assert.deepEqual(JSON.parse(options.body), { websiteId: website.id, postId: first.id });
  });

  it('reports what it could not restore in failed and still restores the rest', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    await createAbility(website, 'galleries');
    const { website: notMine } = await createOwnerWithWebsite();
    const taken = await createGallery(website, { galleryName: 'Interior', deletedAt: daysAgo(1) });
    await createGallery(website, { galleryName: 'INTERIOR' });
    const expired = await createPost(website, { deletedAt: daysAgo(30.01) });
    const notMinePost = await createPost(notMine, { deletedAt: daysAgo(1) });
    const restorable = await createPost(website, { deletedAt: daysAgo(1) });
    const notDeleted = await createThread(owner);

    const res = await post(owner, '/api/siteOwner/deleted/restore').send({
      items: [
        { type: 'gallery', id: taken.id },
        { type: 'post', id: expired.id },
        { type: 'post', id: notMinePost.id },
        { type: 'post', id: restorable.id },
        { type: 'thread', id: notDeleted.id },
        { type: 'update', id: UNKNOWN_ID },
      ],
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: {
        restored: [{ type: 'post', id: restorable.id }],
        failed: [
          { type: 'gallery', id: taken.id, message: 'A gallery with this name already exists.' },
          { type: 'post', id: expired.id, message: 'Post not found.' },
          { type: 'post', id: notMinePost.id, message: 'Post not found.' },
          { type: 'thread', id: notDeleted.id, message: 'Thread not found.' },
          { type: 'update', id: UNKNOWN_ID, message: 'Update not found.' },
        ],
      },
    });
    const storedGallery = await prisma.gallery.findUnique({ where: { id: taken.id } });
    assert.ok(storedGallery.deletedAt instanceof Date);
    assert.deepEqual(await auditEvents(), [
      event(owner, 'post.restored', 'post', restorable.id, { websiteId: website.id }),
    ]);
  });

  it('answers 200 when every item failed', async () => {
    const owner = await createSiteOwner();

    const res = await post(owner, '/api/siteOwner/deleted/restore').send({
      items: [{ type: 'post', id: UNKNOWN_ID }],
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: {
        restored: [],
        failed: [{ type: 'post', id: UNKNOWN_ID, message: 'Post not found.' }],
      },
    });
  });

  it('reports a gallery as not found while its website has Photo Galleries removed', async () => {
    const { owner, website } = await createOwnerWithWebsite();
    await createAbility(website, 'galleries', { removedAt: daysAgo(1) });
    const gallery = await createGallery(website, { deletedAt: daysAgo(1) });

    const res = await post(owner, '/api/siteOwner/deleted/restore').send({
      items: [{ type: 'gallery', id: gallery.id }],
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: {
        restored: [],
        failed: [{ type: 'gallery', id: gallery.id, message: 'Gallery not found.' }],
      },
    });
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('returns 400 for a type outside Recently Deleted', async () => {
    const owner = await createSiteOwner();

    const res = await post(owner, '/api/siteOwner/deleted/restore').send({
      items: [{ type: 'ability', id: UNKNOWN_ID }],
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: { 'items.0.type': 'Type must be post, gallery, update or thread.' },
      },
    });
  });
});
