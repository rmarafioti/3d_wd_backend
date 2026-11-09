// Request tests for the admin's update routes (api/admin/notifications.js).
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
  sessionCookie,
  auditEvents,
} = require('../../testing/helpers');

const UPDATE_NOT_FOUND = { error: { message: 'Update not found.' } };
const VALIDATION_FAILED = 'Please fix the highlighted fields.';
const UNKNOWN_ID = '019a0000-0000-7000-8000-000000000000';

beforeEach(resetState);
after(disconnect);

function as(account, method, path) {
  return request(app)[method](path).set('Cookie', sessionCookie(account)).set(CSRF);
}

function recipientIds(notificationId) {
  return prisma.notificationRecipient
    .findMany({ where: { notificationId }, select: { accountId: true } })
    .then((rows) => rows.map((row) => row.accountId).sort());
}

describe('POST /api/admin/notifications', () => {
  it('sends the update to every active site owner and returns counts, never names', async () => {
    const admin = await createAdmin();
    const alice = await createSiteOwner({ name: 'Alice' });
    const bob = await createSiteOwner({ name: 'Bob' });
    await createSiteOwner({ active: false });

    const res = await as(admin, 'post', '/api/admin/notifications').send({
      title: '  New feature  ',
      body: 'Read **this**',
    });

    assert.equal(res.status, 201);
    const { id, createdAt, updatedAt } = res.body.data;
    assert.deepEqual(res.body.data, {
      id,
      title: 'New feature',
      body: 'Read **this**',
      kind: 'general',
      createdAt,
      updatedAt,
      recipientCount: 2,
      readCount: 0,
    });
    assert.deepEqual(await recipientIds(res.body.data.id), [alice.id, bob.id].sort());
  });

  it('writes notification.sent with the count, never the title or body', async () => {
    const admin = await createAdmin();
    await createSiteOwner();

    const res = await as(admin, 'post', '/api/admin/notifications').send({
      title: 'Secret plans',
      body: 'Private words',
    });

    assert.deepEqual(await auditEvents(), [
      {
        action: 'notification.sent',
        actorId: admin.id,
        actorEmail: admin.email,
        targetType: 'notification',
        targetId: res.body.data.id,
        metadata: { recipientCount: 1, kind: 'general' },
      },
    ]);
  });

  it('returns 400 with a message for each field', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'post', '/api/admin/notifications').send({
      title: 'x'.repeat(121),
      body: '[menu](http://example.com)',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: VALIDATION_FAILED,
        fields: {
          title: 'Title must be 120 characters or fewer.',
          body: 'Each link must be a valid URL starting with https://',
        },
      },
    });
  });

  it('returns 400 when the title and body are blank', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'post', '/api/admin/notifications').send({
      title: '  ',
      body: '',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, {
      title: 'Title is required.',
      body: 'Body is required.',
    });
  });

  it('returns 400 for a body over 10000 characters', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'post', '/api/admin/notifications').send({
      title: 'Hi',
      body: 'x'.repeat(10001),
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, { body: 'Body must be 10000 characters or fewer.' });
  });

  it('returns 403 without the CSRF header', async () => {
    const admin = await createAdmin();

    const res = await request(app)
      .post('/api/admin/notifications')
      .set('Cookie', sessionCookie(admin))
      .send({ title: 'Hi', body: 'Hello' });

    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: { message: 'Request blocked.' } });
  });

  it('returns 403 for a site owner', async () => {
    const owner = await createSiteOwner();

    const res = await as(owner, 'post', '/api/admin/notifications').send({
      title: 'Hi',
      body: 'Hello',
    });

    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: { message: 'You do not have access to this page.' } });
  });
});

describe('GET /api/admin/notifications', () => {
  it('lists updates not withdrawn, newest first, with read counts', async () => {
    const admin = await createAdmin();
    const alice = await createSiteOwner();
    const bob = await createSiteOwner();
    const older = await createNotification(admin, [alice, bob], { title: 'Older' });
    await createNotification(admin, [alice], { title: 'Gone', deletedAt: new Date() });
    const newer = await createNotification(admin, [alice], { title: 'Newer' });
    await prisma.notificationRecipient.updateMany({
      where: { notificationId: older.id, accountId: alice.id },
      data: { readAt: new Date() },
    });

    const res = await as(admin, 'get', '/api/admin/notifications');

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map(({ id, recipientCount, readCount }) => ({ id, recipientCount, readCount })),
      [
        { id: newer.id, recipientCount: 1, readCount: 0 },
        { id: older.id, recipientCount: 2, readCount: 1 },
      ],
    );
    assert.equal(res.body.nextCursor, null);
  });

  it('pages with limit and cursor', async () => {
    const admin = await createAdmin();
    const first = await createNotification(admin, []);
    const second = await createNotification(admin, []);
    const third = await createNotification(admin, []);

    const page1 = await as(admin, 'get', '/api/admin/notifications?limit=2');
    const page2 = await as(
      admin,
      'get',
      `/api/admin/notifications?limit=2&cursor=${page1.body.nextCursor}`,
    );

    assert.deepEqual(
      page1.body.data.map((item) => item.id),
      [third.id, second.id],
    );
    assert.equal(page1.body.nextCursor, second.id);
    assert.deepEqual(
      page2.body.data.map((item) => item.id),
      [first.id],
    );
    assert.equal(page2.body.nextCursor, null);
  });

  it('returns 400 for a bad limit', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'get', '/api/admin/notifications?limit=0');

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, {
      limit: 'Limit must be a whole number from 1 to 100.',
    });
  });
});

describe('PATCH /api/admin/notifications/:id', () => {
  it('edits the title and body and keeps recipients and read state', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const notification = await createNotification(admin, [owner]);
    const readAt = new Date('2026-11-01T12:00:00.000Z');
    await prisma.notificationRecipient.updateMany({ data: { readAt } });

    const res = await as(admin, 'patch', `/api/admin/notifications/${notification.id}`).send({
      title: 'Fixed',
      body: 'Typo fixed',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.title, 'Fixed');
    assert.equal(res.body.data.body, 'Typo fixed');
    assert.equal(res.body.data.recipientCount, 1);
    assert.equal(res.body.data.readCount, 1);
    const stored = await prisma.notificationRecipient.findFirst({ select: { readAt: true } });
    assert.deepEqual(stored, { readAt });
    assert.deepEqual(
      (await auditEvents()).map((event) => [event.action, event.targetId, event.metadata]),
      [['notification.updated', notification.id, null]],
    );
  });

  it('returns 404 for a withdrawn or unknown update', async () => {
    const admin = await createAdmin();
    const withdrawn = await createNotification(admin, [], { deletedAt: new Date() });

    for (const id of [withdrawn.id, UNKNOWN_ID]) {
      const res = await as(admin, 'patch', `/api/admin/notifications/${id}`).send({
        title: 'Fixed',
        body: 'Typo fixed',
      });
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, UPDATE_NOT_FOUND);
    }
  });
});

describe('DELETE /api/admin/notifications/:id', () => {
  it('withdraws the update: deletedAt set, gone from the inbox, audited', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const notification = await createNotification(admin, [owner]);

    const res = await as(admin, 'delete', `/api/admin/notifications/${notification.id}`);
    const inbox = await as(owner, 'get', '/api/siteOwner/notifications');
    const again = await as(admin, 'delete', `/api/admin/notifications/${notification.id}`);

    assert.equal(res.status, 204);
    const stored = await prisma.notification.findUnique({ where: { id: notification.id } });
    assert.ok(stored.deletedAt);
    assert.deepEqual(inbox.body.data, []);
    assert.equal(again.status, 404);
    assert.deepEqual(
      (await auditEvents()).map((event) => event.action),
      ['notification.withdrawn'],
    );
  });
});

describe('updates the admin deleted from their mailbox', () => {
  it('leave the list and are not found on edit and withdraw; site owners keep them', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const notification = await createNotification(admin, [owner], { adminDeletedAt: new Date() });
    const path = `/api/admin/notifications/${notification.id}`;

    const list = await as(admin, 'get', '/api/admin/notifications');
    const responses = [
      await as(admin, 'patch', path).send({ title: 'T', body: 'B' }),
      await as(admin, 'delete', path),
    ];

    assert.deepEqual(list.body.data, []);
    for (const res of responses) {
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, UPDATE_NOT_FOUND);
    }
    const ownerList = await as(owner, 'get', '/api/siteOwner/notifications');
    assert.equal(ownerList.body.data.length, 1);
  });
});
