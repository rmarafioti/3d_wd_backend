// Site owner routes for their message threads with the admin: start, list, read, reply and mark
// read. Mounted by api/siteOwner/index.js, behind its site owner guards.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const { validate } = require('../../validation/validate');
const {
  startThreadSchema,
  threadMessageSchema,
  listThreadsSchema,
} = require('../../validation/thread');
const { threadMessageRateLimit } = require('../../lib/rateLimit');
const {
  THREAD_SELECT,
  inMailboxWhere,
  toThread,
  listThreads,
  startThread,
  addThreadMessage,
  markThreadRead,
} = require('../../lib/threads');

const router = express.Router();

const THREAD_NOT_FOUND = 'Thread not found.';

// The account's own thread in its mailbox, or a 404: another site owner's thread, and one this
// site owner deleted, read as not found.
async function findOwnedThread(accountId, id, select = { id: true }) {
  const thread = await prisma.thread.findFirst({
    where: { id, accountId, ...inMailboxWhere('owner') },
    select,
  });
  if (!thread) throw new ServerError(404, THREAD_NOT_FOUND);
  return thread;
}

// POST /api/siteOwner/threads — body { subject, message }. Starts a thread with the admin: a
// suggestion, a question, an idea. Unread for the admin until they open it.
router.post('/', threadMessageRateLimit, async (req, res) => {
  const input = validate(startThreadSchema, req.body ?? {});

  const thread = await prisma.$transaction((tx) =>
    startThread(tx, req, { ...input, accountId: req.user.id, side: 'owner' }),
  );

  res.status(201).json({ data: toThread(thread, 'owner') });
});

// GET /api/siteOwner/threads — the account's threads, newest activity first, a page at a time
// (limit, cursor), each saying whether it has a reply they haven't read.
router.get('/', async (req, res) => {
  const input = validate(listThreadsSchema, req.query);
  res.json(
    await listThreads({ accountId: req.user.id, ...inMailboxWhere('owner') }, input, 'owner'),
  );
});

// GET /api/siteOwner/threads/:id — one of the account's threads with its messages, oldest first.
router.get('/:id', async (req, res) => {
  const thread = await findOwnedThread(req.user.id, req.params.id, THREAD_SELECT);
  res.json({ data: toThread(thread, 'owner') });
});

// POST /api/siteOwner/threads/:id/messages — body { message }. The site owner's reply.
router.post('/:id/messages', threadMessageRateLimit, async (req, res) => {
  const input = validate(threadMessageSchema, req.body ?? {});

  const { id } = await findOwnedThread(req.user.id, req.params.id);

  const thread = await prisma.$transaction((tx) =>
    addThreadMessage(tx, req, id, 'owner', input.message),
  );
  res.status(201).json({ data: toThread(thread, 'owner') });
});

// POST /api/siteOwner/threads/:id/read — marks one of the account's threads read for them.
router.post('/:id/read', async (req, res) => {
  const { id } = await findOwnedThread(req.user.id, req.params.id);
  res.json({ data: await markThreadRead(id, 'owner') });
});

module.exports = router;
