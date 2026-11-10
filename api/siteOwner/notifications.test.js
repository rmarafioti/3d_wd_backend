// Request tests for the site owner's update routes (api/siteOwner/notifications.js).
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
  createNotification,
  createThread,
  sessionCookie,
  auditEvents,
} = require('../../testing/helpers');

const UPDATE_NOT_FOUND = { error: { message: 'Update not found.' } };

beforeEach(resetState);
after(disconnect);

function as(account, method, path) {
  return request(app)[method](path).set('Cookie', sessionCookie(account)).set(CSRF);
}

describe('GET /api/siteOwner/notifications', () => {
  it("lists only the account's own updates, newest first, without withdrawn ones", async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const other = await createSiteOwner();
    const older = await createNotification(admin, [owner], { title: 'Older', kind: 'automatic' });
    await createNotification(admin, [other], { title: 'Not mine' });
    await createNotification(admin, [owner], { title: 'Withdrawn', deletedAt: new Date() });
    const newer = await createNotification(admin, [owner], { title: 'Newer', body: '**Hi**' });

    const res = await as(owner, 'get', '/api/siteOwner/notifications');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: [
        {
          id: newer.id,
          title: 'Newer',
          body: '**Hi**',
          kind: 'general',
          createdAt: newer.createdAt.toISOString(),
          updatedAt: newer.updatedAt.toISOString(),
          readAt: null,
        },
        {
          id: older.id,
          title: 'Older',
          body: 'News',
          kind: 'automatic',
          createdAt: older.createdAt.toISOString(),
          updatedAt: older.updatedAt.toISOString(),
          readAt: null,
        },
      ],
      nextCursor: null,
    });
  });

  it('never shows an account an update sent before it was created', async () => {
    const admin = await createAdmin();
    const early = await createSiteOwner();
    await as(admin, 'post', '/api/admin/notifications').send({
      title: 'Hi',
      body: 'Everyone',
    });
    const late = await createSiteOwner();

    const res = await as(late, 'get', '/api/siteOwner/notifications');
    const earlyRes = await as(early, 'get', '/api/siteOwner/notifications');

    assert.deepEqual(res.body.data, []);
    assert.equal(earlyRes.body.data.length, 1);
  });

  it('pages with limit and cursor', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const first = await createNotification(admin, [owner]);
    const second = await createNotification(admin, [owner]);

    const page1 = await as(owner, 'get', '/api/siteOwner/notifications?limit=1');
    const page2 = await as(
      owner,
      'get',
      `/api/siteOwner/notifications?limit=1&cursor=${page1.body.nextCursor}`,
    );

    assert.deepEqual(
      page1.body.data.map((item) => item.id),
      [second.id],
    );
    assert.equal(page1.body.nextCursor, second.id);
    assert.deepEqual(
      page2.body.data.map((item) => item.id),
      [first.id],
    );
    assert.equal(page2.body.nextCursor, null);
  });

  it('returns 400 for a limit over 100 and a cursor that is not an id', async () => {
    const owner = await createSiteOwner();

    const res = await as(owner, 'get', '/api/siteOwner/notifications?limit=101&cursor=abc');

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

describe('GET /api/siteOwner/notifications/unreadCount', () => {
  it('counts unread updates and threads with an unread reply', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const other = await createSiteOwner();
    await createNotification(admin, [owner]);
    await createNotification(admin, [owner, other]);
    await createNotification(admin, [owner], { deletedAt: new Date() });
    const read = await createNotification(admin, [owner]);
    await prisma.notificationRecipient.updateMany({
      where: { notificationId: read.id },
      data: { readAt: new Date() },
    });
    const replied = await createThread(owner);
    await prisma.thread.update({
      where: { id: replied.id },
      data: { lastMessageAt: new Date(Date.now() + 1000) },
    });
    await createThread(owner);
    await createThread(other, { ownerReadAt: null });

    const res = await as(owner, 'get', '/api/siteOwner/notifications/unreadCount');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: { updates: 2, threads: 1 } });
  });
});

describe('POST /api/siteOwner/notifications/:id/read', () => {
  it('marks the update read once, keeping the first readAt, and writes no audit event', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const notification = await createNotification(admin, [owner]);

    const first = await as(owner, 'post', `/api/siteOwner/notifications/${notification.id}/read`);
    const second = await as(owner, 'post', `/api/siteOwner/notifications/${notification.id}/read`);

    assert.equal(first.status, 200);
    assert.equal(first.body.data.id, notification.id);
    assert.ok(first.body.data.readAt);
    assert.equal(second.body.data.readAt, first.body.data.readAt);
    assert.deepEqual(await auditEvents(), []);
  });

  it("returns 404 for another account's update and a withdrawn one", async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const other = await createSiteOwner();
    const theirs = await createNotification(admin, [other]);
    const withdrawn = await createNotification(admin, [owner], { deletedAt: new Date() });

    for (const id of [theirs.id, withdrawn.id, 'not-an-id']) {
      const res = await as(owner, 'post', `/api/siteOwner/notifications/${id}/read`);
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, UPDATE_NOT_FOUND);
    }
    const stored = await prisma.notificationRecipient.findFirst({ where: { accountId: other.id } });
    assert.equal(stored.readAt, null);
  });
});

// Sets fields on the account's copy of an update, such as its readAt or deletedAt.
function setRecipient(owner, notification, data) {
  return prisma.notificationRecipient.updateMany({
    where: { accountId: owner.id, notificationId: notification.id },
    data,
  });
}

describe('updates the site owner deleted', () => {
  it('leave the list and unread count, and are not found on read', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const notification = await createNotification(admin, [owner]);
    await setRecipient(owner, notification, { deletedAt: new Date() });

    const list = await as(owner, 'get', '/api/siteOwner/notifications');
    const count = await as(owner, 'get', '/api/siteOwner/notifications/unreadCount');
    const read = await as(owner, 'post', `/api/siteOwner/notifications/${notification.id}/read`);

    assert.deepEqual(list.body.data, []);
    assert.deepEqual(count.body, { data: { updates: 0, threads: 0 } });
    assert.equal(read.status, 404);
    assert.deepEqual(read.body, UPDATE_NOT_FOUND);
  });
});
