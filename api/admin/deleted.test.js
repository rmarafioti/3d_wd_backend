// Request tests for the admin's Recently Deleted routes (api/admin/deleted.js): the list, bulk
// delete and bulk restore.
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
  createAdmin,
  createSiteOwner,
  createOwnerWithWebsite,
  createPost,
  createNotification,
  createThread,
  sessionCookie,
  auditEvents,
} = require('../../testing/helpers');

const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_ID = '019a0000-0000-7000-8000-000000000000';

beforeEach(resetState);
after(disconnect);

function get(account, path) {
  return request(app).get(path).set('Cookie', sessionCookie(account));
}

function post(account, path) {
  return request(app).post(path).set('Cookie', sessionCookie(account)).set(CSRF);
}

// The audit event of the admin's change to one item.
function event(account, action, targetType, targetId) {
  return {
    action,
    actorId: account.id,
    actorEmail: account.email,
    targetType,
    targetId,
    metadata: null,
  };
}

function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS);
}

function expectedItem(type, id, name, deletedAt) {
  return {
    type,
    id,
    name,
    websiteId: null,
    websiteName: null,
    deletedAt: deletedAt.toISOString(),
    restorableUntil: new Date(deletedAt.getTime() + 30 * DAY_MS).toISOString(),
  };
}

describe('GET /api/admin/deleted', () => {
  it('lists the updates and threads the admin deleted, newest deletion first', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const update = await createNotification(admin, [owner], {
      title: 'News',
      adminDeletedAt: daysAgo(2),
    });
    const thread = await createThread(owner, { subject: 'Hours', adminDeletedAt: daysAgo(1) });

    const res = await get(admin, '/api/admin/deleted');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: [
        expectedItem('thread', thread.id, 'Hours', thread.adminDeletedAt),
        expectedItem('update', update.id, 'News', update.adminDeletedAt),
      ],
      nextCursor: null,
    });
  });

  it("leaves out site owners' deletes, withdrawn updates, posts and items over 30 days old", async () => {
    const admin = await createAdmin();
    const { owner, website } = await createOwnerWithWebsite();
    await createNotification(admin, [owner], { adminDeletedAt: daysAgo(30.01) });
    await createNotification(admin, [owner], { adminDeletedAt: daysAgo(1), deletedAt: daysAgo(1) });
    await createThread(owner, { ownerDeletedAt: daysAgo(1) });
    await createThread(owner, { adminDeletedAt: daysAgo(30.01) });
    await createPost(website, { deletedAt: daysAgo(1) });

    const res = await get(admin, '/api/admin/deleted');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: [], nextCursor: null });
  });

  it('pages with limit and cursor', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const update = await createNotification(admin, [], { adminDeletedAt: daysAgo(2) });
    const thread = await createThread(owner, { adminDeletedAt: daysAgo(1) });

    const first = await get(admin, '/api/admin/deleted?limit=1');
    const second = await get(admin, `/api/admin/deleted?limit=1&cursor=${first.body.nextCursor}`);

    assert.deepEqual(
      first.body.data.map((item) => item.id),
      [thread.id],
    );
    assert.equal(first.body.nextCursor, thread.id);
    assert.deepEqual(
      second.body.data.map((item) => item.id),
      [update.id],
    );
    assert.equal(second.body.nextCursor, null);
  });
});

describe('POST /api/admin/deleted', () => {
  it("hides sent updates and threads from the admin's mailbox only; site owners keep them", async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const update = await createNotification(admin, [owner]);
    const thread = await createThread(owner);

    const res = await post(admin, '/api/admin/deleted').send({
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
    const storedUpdate = await prisma.notification.findUnique({ where: { id: update.id } });
    assert.ok(storedUpdate.adminDeletedAt instanceof Date);
    assert.equal(storedUpdate.deletedAt, null);
    const storedThread = await prisma.thread.findUnique({ where: { id: thread.id } });
    assert.ok(storedThread.adminDeletedAt instanceof Date);
    assert.equal(storedThread.ownerDeletedAt, null);
    const ownerUpdates = await get(owner, '/api/siteOwner/notifications');
    assert.equal(ownerUpdates.body.data.length, 1);
    const ownerThreads = await get(owner, '/api/siteOwner/threads');
    assert.equal(ownerThreads.body.data.length, 1);
    assert.deepEqual(await auditEvents(), [
      event(admin, 'notification.deleted', 'notification', update.id),
      event(admin, 'thread.deleted', 'thread', thread.id),
    ]);
  });

  it('reports withdrawn, already deleted and unknown items in failed', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const withdrawn = await createNotification(admin, [owner], { deletedAt: new Date() });
    const alreadyDeleted = await createThread(owner, { adminDeletedAt: new Date() });

    const res = await post(admin, '/api/admin/deleted').send({
      items: [
        { type: 'update', id: withdrawn.id },
        { type: 'thread', id: alreadyDeleted.id },
        { type: 'thread', id: UNKNOWN_ID },
      ],
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: {
        deleted: [],
        failed: [
          { type: 'update', id: withdrawn.id, message: 'Update not found.' },
          { type: 'thread', id: alreadyDeleted.id, message: 'Thread not found.' },
          { type: 'thread', id: UNKNOWN_ID, message: 'Thread not found.' },
        ],
      },
    });
    assert.deepEqual(await auditEvents(), []);
  });

  it('returns 400 for a post', async () => {
    const admin = await createAdmin();

    const res = await post(admin, '/api/admin/deleted').send({
      items: [{ type: 'post', id: UNKNOWN_ID }],
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: { 'items.0.type': 'Type must be update or thread.' },
      },
    });
  });
});

describe('POST /api/admin/deleted/restore', () => {
  it('brings deleted updates and threads back to the admin mailbox, with their events', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const update = await createNotification(admin, [owner], { adminDeletedAt: daysAgo(1) });
    const thread = await createThread(owner, { adminDeletedAt: daysAgo(1) });
    const items = [
      { type: 'update', id: update.id },
      { type: 'thread', id: thread.id },
    ];

    const res = await post(admin, '/api/admin/deleted/restore').send({ items });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: { restored: items, failed: [] } });
    const list = await get(admin, '/api/admin/notifications');
    assert.equal(list.body.data.length, 1);
    const threads = await get(admin, '/api/admin/threads');
    assert.equal(threads.body.data.length, 1);
    assert.deepEqual(await auditEvents(), [
      event(admin, 'notification.restored', 'notification', update.id),
      event(admin, 'thread.restored', 'thread', thread.id),
    ]);
  });

  it('reports items deleted over 30 days ago, withdrawn, or deleted only by the site owner', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const expired = await createNotification(admin, [owner], { adminDeletedAt: daysAgo(30.01) });
    const withdrawn = await createNotification(admin, [owner], {
      adminDeletedAt: daysAgo(1),
      deletedAt: daysAgo(1),
    });
    const ownerDeleted = await createThread(owner, { ownerDeletedAt: daysAgo(1) });

    const res = await post(admin, '/api/admin/deleted/restore').send({
      items: [
        { type: 'update', id: expired.id },
        { type: 'update', id: withdrawn.id },
        { type: 'thread', id: ownerDeleted.id },
      ],
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: {
        restored: [],
        failed: [
          { type: 'update', id: expired.id, message: 'Update not found.' },
          { type: 'update', id: withdrawn.id, message: 'Update not found.' },
          { type: 'thread', id: ownerDeleted.id, message: 'Thread not found.' },
        ],
      },
    });
  });

  it('returns 400 for a gallery, which the admin has none of', async () => {
    const admin = await createAdmin();

    const res = await post(admin, '/api/admin/deleted/restore').send({
      items: [{ type: 'gallery', id: UNKNOWN_ID }],
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, { 'items.0.type': 'Type must be update or thread.' });
  });
});
