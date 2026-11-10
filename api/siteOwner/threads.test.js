// Request tests for the site owner's thread routes (api/siteOwner/threads.js).
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

beforeEach(resetState);
after(disconnect);

function as(account, method, path) {
  return request(app)[method](path).set('Cookie', sessionCookie(account)).set(CSRF);
}

describe('POST /api/siteOwner/threads', () => {
  it('starts a thread with its first message, read by the site owner, unread by the admin', async () => {
    const owner = await createSiteOwner({ name: 'Alice' });

    const res = await as(owner, 'post', '/api/siteOwner/threads').send({
      subject: '  An idea  ',
      message: 'Could we add *hours*?',
    });

    assert.equal(res.status, 201);
    const { id, lastMessageAt, createdAt, messages } = res.body.data;
    assert.deepEqual(res.body.data, {
      id,
      subject: 'An idea',
      lastMessageAt,
      createdAt,
      unread: false,
      messages: [
        {
          id: messages[0].id,
          from: 'site_owner',
          authorName: 'Alice',
          body: 'Could we add *hours*?',
          createdAt: lastMessageAt,
        },
      ],
    });
    const stored = await prisma.thread.findUnique({ where: { id } });
    assert.equal(stored.accountId, owner.id);
    assert.equal(stored.adminReadAt, null);
    assert.deepEqual(await auditEvents(), [
      {
        action: 'thread.started',
        actorId: owner.id,
        actorEmail: owner.email,
        targetType: 'thread',
        targetId: id,
        metadata: null,
      },
    ]);
  });

  it('returns 400 for a blank subject and a message with a non-https link', async () => {
    const owner = await createSiteOwner();

    const res = await as(owner, 'post', '/api/siteOwner/threads').send({
      subject: ' ',
      message: 'See [this](http://example.com)',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, {
      subject: 'Subject is required.',
      message: 'Each link must be a valid URL starting with https://',
    });
  });

  it('returns 400 for a message over 5000 characters', async () => {
    const owner = await createSiteOwner();

    const res = await as(owner, 'post', '/api/siteOwner/threads').send({
      subject: 'Hi',
      message: 'x'.repeat(5001),
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, {
      message: 'Message must be 5000 characters or fewer.',
    });
  });

  it('returns 429 after 20 new threads and replies in 15 minutes', async () => {
    const owner = await createSiteOwner();
    const thread = await createThread(owner);
    for (let i = 0; i < 10; i += 1) {
      await as(owner, 'post', '/api/siteOwner/threads').send({ subject: 'Hi', message: 'Hello' });
      await as(owner, 'post', `/api/siteOwner/threads/${thread.id}/messages`).send({
        message: 'Again',
      });
    }

    const res = await as(owner, 'post', '/api/siteOwner/threads').send({
      subject: 'Hi',
      message: 'Hello',
    });

    assert.equal(res.status, 429);
    assert.deepEqual(res.body, {
      error: { message: 'Too many requests. Please try again later.' },
    });
  });
});

describe('GET /api/siteOwner/threads', () => {
  it("lists only the account's threads, newest activity first, with unread state", async () => {
    const owner = await createSiteOwner();
    const other = await createSiteOwner();
    const quiet = await createThread(owner, { subject: 'Quiet' });
    const replied = await createThread(owner, {
      subject: 'Replied',
      lastMessageAt: new Date(Date.now() + 60000),
    });
    await createThread(other);

    const res = await as(owner, 'get', '/api/siteOwner/threads');

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map(({ id, subject, unread, account }) => ({ id, subject, unread, account })),
      [
        { id: replied.id, subject: 'Replied', unread: true, account: undefined },
        { id: quiet.id, subject: 'Quiet', unread: false, account: undefined },
      ],
    );
    assert.equal(res.body.nextCursor, null);
  });

  it('pages with limit and cursor', async () => {
    const owner = await createSiteOwner();
    const older = await createThread(owner, { lastMessageAt: new Date('2026-11-01T00:00:00Z') });
    const newer = await createThread(owner, { lastMessageAt: new Date('2026-11-02T00:00:00Z') });

    const page1 = await as(owner, 'get', '/api/siteOwner/threads?limit=1');
    const page2 = await as(owner, 'get', `/api/siteOwner/threads?limit=1&cursor=${newer.id}`);

    assert.deepEqual(
      page1.body.data.map((item) => item.id),
      [newer.id],
    );
    assert.equal(page1.body.nextCursor, newer.id);
    assert.deepEqual(
      page2.body.data.map((item) => item.id),
      [older.id],
    );
    assert.equal(page2.body.nextCursor, null);
  });

  it('returns 400 for a limit over 100 and a cursor that is not an id', async () => {
    const owner = await createSiteOwner();

    const res = await as(owner, 'get', '/api/siteOwner/threads?limit=101&cursor=abc');

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

describe('GET /api/siteOwner/threads/:id', () => {
  it("returns the thread's messages oldest first, naming who wrote each", async () => {
    const admin = await createAdmin({ name: 'Rich' });
    const owner = await createSiteOwner({ name: 'Alice' });
    const thread = await createThread(owner);
    await as(admin, 'post', `/api/admin/threads/${thread.id}/messages`).send({ message: 'Sure' });

    const res = await as(owner, 'get', `/api/siteOwner/threads/${thread.id}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.unread, true);
    assert.deepEqual(
      res.body.data.messages.map(({ from, authorName, body }) => ({ from, authorName, body })),
      [
        { from: 'site_owner', authorName: 'Alice', body: 'Hello' },
        { from: 'admin', authorName: 'Rich', body: 'Sure' },
      ],
    );
  });

  it("returns 404 for another site owner's thread", async () => {
    const owner = await createSiteOwner();
    const theirs = await createThread(await createSiteOwner());

    for (const path of [
      `/api/siteOwner/threads/${theirs.id}`,
      `/api/siteOwner/threads/not-an-id`,
    ]) {
      const res = await as(owner, 'get', path);
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, THREAD_NOT_FOUND);
    }
  });
});

describe('POST /api/siteOwner/threads/:id/messages', () => {
  it('adds the reply, moves lastMessageAt and leaves it unread for the admin only', async () => {
    const owner = await createSiteOwner();
    const past = new Date('2026-11-01T00:00:00Z');
    const thread = await createThread(owner, {
      lastMessageAt: past,
      ownerReadAt: past,
      adminReadAt: past,
    });

    const res = await as(owner, 'post', `/api/siteOwner/threads/${thread.id}/messages`).send({
      message: 'One more thing',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.messages.length, 2);
    assert.equal(res.body.data.unread, false);
    const stored = await prisma.thread.findUnique({ where: { id: thread.id } });
    assert.ok(stored.lastMessageAt > past);
    assert.equal(stored.ownerReadAt.getTime(), stored.lastMessageAt.getTime());
    assert.ok(stored.adminReadAt < stored.lastMessageAt);
    assert.deepEqual(
      (await auditEvents()).map((event) => [event.action, event.actorId, event.targetId]),
      [['thread.replied', owner.id, thread.id]],
    );
  });

  it('returns 400 for a blank reply, and adds nothing', async () => {
    const owner = await createSiteOwner();
    const thread = await createThread(owner);

    const res = await as(owner, 'post', `/api/siteOwner/threads/${thread.id}/messages`).send({
      message: ' ',
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.fields, { message: 'Message is required.' });
    assert.equal(await prisma.threadMessage.count({ where: { threadId: thread.id } }), 1);
  });

  it('returns 409 once the thread has 100 messages, and adds nothing', async () => {
    const owner = await createSiteOwner();
    const thread = await createThread(owner);
    await prisma.threadMessage.createMany({
      data: Array.from({ length: 99 }, () => ({
        threadId: thread.id,
        authorId: owner.id,
        body: 'More',
      })),
    });

    const res = await as(owner, 'post', `/api/siteOwner/threads/${thread.id}/messages`).send({
      message: 'One too many',
    });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      error: { message: 'This thread is full. Start a new thread.' },
    });
    assert.equal(await prisma.threadMessage.count(), 100);
    assert.deepEqual(await auditEvents(), []);
  });

  it("returns 404 for another site owner's thread", async () => {
    const owner = await createSiteOwner();
    const theirs = await createThread(await createSiteOwner());

    const res = await as(owner, 'post', `/api/siteOwner/threads/${theirs.id}/messages`).send({
      message: 'Hi',
    });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, THREAD_NOT_FOUND);
    assert.equal(await prisma.threadMessage.count(), 1);
  });
});

describe('POST /api/siteOwner/threads/:id/read', () => {
  it('marks the thread read for the site owner', async () => {
    const owner = await createSiteOwner();
    const thread = await createThread(owner, { ownerReadAt: null });

    const res = await as(owner, 'post', `/api/siteOwner/threads/${thread.id}/read`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.unread, false);
    assert.equal(res.body.data.messages, undefined);
  });

  it("returns 404 for another site owner's thread", async () => {
    const owner = await createSiteOwner();
    const theirs = await createThread(await createSiteOwner(), { ownerReadAt: null });

    const res = await as(owner, 'post', `/api/siteOwner/threads/${theirs.id}/read`);

    assert.equal(res.status, 404);
    const stored = await prisma.thread.findUnique({ where: { id: theirs.id } });
    assert.equal(stored.ownerReadAt, null);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe('threads the site owner deleted', () => {
  it('leave the list and unread count, and are not found on every route', async () => {
    const owner = await createSiteOwner();
    const thread = await createThread(owner, { ownerReadAt: null, ownerDeletedAt: new Date() });
    const path = `/api/siteOwner/threads/${thread.id}`;

    const list = await as(owner, 'get', '/api/siteOwner/threads');
    const count = await as(owner, 'get', '/api/siteOwner/notifications/unreadCount');
    const responses = [
      await as(owner, 'get', path),
      await as(owner, 'post', `${path}/messages`).send({ message: 'Hi' }),
      await as(owner, 'post', `${path}/read`),
    ];

    assert.deepEqual(list.body.data, []);
    assert.deepEqual(count.body, { data: { updates: 0, threads: 0 } });
    for (const res of responses) {
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, THREAD_NOT_FOUND);
    }
  });

  it('come back to the mailbox, unread, when the admin replies, even after 30 days', async () => {
    const admin = await createAdmin();
    const owner = await createSiteOwner();
    const thread = await createThread(owner, {
      ownerDeletedAt: new Date(Date.now() - 40 * DAY_MS),
    });

    await as(admin, 'post', `/api/admin/threads/${thread.id}/messages`).send({ message: 'Hi' });

    const list = await as(owner, 'get', '/api/siteOwner/threads');
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].unread, true);
    const deleted = await as(owner, 'get', '/api/siteOwner/deleted');
    assert.deepEqual(deleted.body.data, []);
  });
});
