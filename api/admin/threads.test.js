// Request tests for the admin's thread routes (api/admin/threads.js).
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
  createThread,
  sessionCookie,
  auditEvents,
} = require('../../testing/helpers');

const THREAD_NOT_FOUND = { error: { message: 'Thread not found.' } };
const UNKNOWN_ID = '019a0000-0000-7000-8000-000000000000';

beforeEach(resetState);
after(disconnect);

function as(account, method, path) {
  return request(app)[method](path).set('Cookie', sessionCookie(account)).set(CSRF);
}

describe('POST /api/admin/threads', () => {
  it('starts a thread with a site owner, read by the admin and unread for the site owner', async () => {
    const admin = await createAdmin({ name: 'Rich' });
    const owner = await createSiteOwner({ name: 'Alice' });

    const res = await as(admin, 'post', '/api/admin/threads').send({
      accountId: owner.id,
      subject: 'Your new page',
      message: 'Have a look at [the mock-up](https://example.com/mock).',
    });
    const ownerList = await as(owner, 'get', '/api/siteOwner/threads');

    assert.equal(res.status, 201);
    assert.equal(res.body.data.subject, 'Your new page');
    assert.equal(res.body.data.unread, false);
    assert.deepEqual(res.body.data.account, { id: owner.id, name: 'Alice' });
    assert.deepEqual(
      res.body.data.messages.map(({ from, authorName }) => ({ from, authorName })),
      [{ from: 'admin', authorName: 'Rich' }],
    );
    assert.deepEqual(
      ownerList.body.data.map(({ id, unread }) => ({ id, unread })),
      [{ id: res.body.data.id, unread: true }],
    );
    assert.deepEqual(await auditEvents(), [
      {
        action: 'thread.started',
        actorId: admin.id,
        actorEmail: admin.email,
        targetType: 'thread',
        targetId: res.body.data.id,
        metadata: null,
      },
    ]);
  });

  it('returns 404 for an unknown account, an inactive site owner or an admin', async () => {
    const admin = await createAdmin();
    const inactive = await createSiteOwner({ active: false });

    for (const accountId of [UNKNOWN_ID, inactive.id, admin.id]) {
      const res = await as(admin, 'post', '/api/admin/threads').send({
        accountId,
        subject: 'Hi',
        message: 'Hello',
      });
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: { message: 'Account not found.' } });
    }
    assert.equal(await prisma.thread.count(), 0);
  });

  it('returns 400 with a message for each field', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'post', '/api/admin/threads').send({ subject: 'x'.repeat(121) });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: {
          accountId: 'Choose an account.',
          subject: 'Subject must be 120 characters or fewer.',
          message: 'Message is required.',
        },
      },
    });
  });
});

describe('GET /api/admin/threads/unreadCount', () => {
  it('counts the threads with a message the admin has not read', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    await createThread(owner);
    await createThread(owner, { adminReadAt: new Date(Date.now() + 1000) });
    const replied = await createThread(owner, { adminReadAt: new Date('2026-11-01T00:00:00Z') });
    await prisma.thread.update({
      where: { id: replied.id },
      data: { lastMessageAt: new Date('2026-11-02T00:00:00Z') },
    });

    const res = await as(admin, 'get', '/api/admin/threads/unreadCount');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: { threads: 2 } });
  });
});

describe('GET /api/admin/threads', () => {
  it("lists every site owner's threads, newest activity first, with who started each", async () => {
    const admin = await createAdmin();
    const alice = await createSiteOwner({ name: 'Alice' });
    const bob = await createSiteOwner({ name: 'Bob' });
    const older = await createThread(alice, { lastMessageAt: new Date('2026-11-01T00:00:00Z') });
    const newer = await createThread(bob, {
      lastMessageAt: new Date('2026-11-02T00:00:00Z'),
      adminReadAt: new Date('2026-11-03T00:00:00Z'),
    });

    const res = await as(admin, 'get', '/api/admin/threads');

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map(({ id, unread, account }) => ({ id, unread, account })),
      [
        { id: newer.id, unread: false, account: { id: bob.id, name: 'Bob' } },
        { id: older.id, unread: true, account: { id: alice.id, name: 'Alice' } },
      ],
    );
    assert.equal(res.body.nextCursor, null);
  });
});

describe('GET /api/admin/threads/:id', () => {
  it('returns the thread with its messages', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner({ name: 'Alice' });
    const thread = await createThread(owner);

    const res = await as(admin, 'get', `/api/admin/threads/${thread.id}`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.account, { id: owner.id, name: 'Alice' });
    assert.equal(res.body.data.unread, true);
    assert.deepEqual(
      res.body.data.messages.map(({ from, body }) => ({ from, body })),
      [{ from: 'site_owner', body: 'Hello' }],
    );
  });

  it('returns 404 for an unknown thread', async () => {
    const admin = await createAdmin();

    const res = await as(admin, 'get', `/api/admin/threads/${UNKNOWN_ID}`);

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, THREAD_NOT_FOUND);
  });
});

describe('POST /api/admin/threads/:id/messages', () => {
  it('adds the reply, read by the admin and unread for the site owner, audited', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const thread = await createThread(owner);

    const res = await as(admin, 'post', `/api/admin/threads/${thread.id}/messages`).send({
      message: 'Thanks, on it.',
    });
    const ownerList = await as(owner, 'get', '/api/siteOwner/threads');

    assert.equal(res.status, 201);
    assert.equal(res.body.data.unread, false);
    assert.equal(res.body.data.messages.at(-1).from, 'admin');
    assert.equal(ownerList.body.data[0].unread, true);
    assert.deepEqual(
      (await auditEvents()).map((event) => [event.action, event.actorId, event.targetType]),
      [['thread.replied', admin.id, 'thread']],
    );
  });

  it('returns 400 for a blank message and 404 for an unknown thread', async () => {
    const admin = await createAdmin();
    const thread = await createThread(await createSiteOwner());

    const blank = await as(admin, 'post', `/api/admin/threads/${thread.id}/messages`).send({
      message: ' ',
    });
    const unknown = await as(admin, 'post', `/api/admin/threads/${UNKNOWN_ID}/messages`).send({
      message: 'Hi',
    });

    assert.equal(blank.status, 400);
    assert.deepEqual(blank.body.error.fields, { message: 'Message is required.' });
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, THREAD_NOT_FOUND);
  });
});

describe('POST /api/admin/threads/:id/read', () => {
  it('marks the thread read for the admin and leaves the site owner side as it was', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const thread = await createThread(owner, { ownerReadAt: null });

    const res = await as(admin, 'post', `/api/admin/threads/${thread.id}/read`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.unread, false);
    const stored = await prisma.thread.findUnique({ where: { id: thread.id } });
    assert.ok(stored.adminReadAt);
    assert.equal(stored.ownerReadAt, null);
  });
});

describe('threads the admin deleted', () => {
  it('leave the list and unread count, and are not found on every admin route', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const thread = await createThread(owner, { adminDeletedAt: new Date() });
    const path = `/api/admin/threads/${thread.id}`;

    const list = await as(admin, 'get', '/api/admin/threads');
    const count = await as(admin, 'get', '/api/admin/threads/unreadCount');
    const responses = [
      await as(admin, 'get', path),
      await as(admin, 'post', `${path}/messages`).send({ message: 'Hi' }),
      await as(admin, 'post', `${path}/read`),
    ];

    assert.deepEqual(list.body.data, []);
    assert.deepEqual(count.body, { data: { threads: 0 } });
    for (const res of responses) {
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, THREAD_NOT_FOUND);
    }
    const ownerList = await as(owner, 'get', '/api/siteOwner/threads');
    assert.equal(ownerList.body.data.length, 1);
  });

  it("come back to the admin's mailbox, unread, when the site owner replies", async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const thread = await createThread(owner, {
      adminReadAt: new Date(),
      adminDeletedAt: new Date(),
    });

    await as(owner, 'post', `/api/siteOwner/threads/${thread.id}/messages`).send({ message: 'Hi' });

    const list = await as(admin, 'get', '/api/admin/threads');
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].unread, true);
    const deleted = await as(admin, 'get', '/api/admin/deleted');
    assert.deepEqual(deleted.body.data, []);
  });
});
