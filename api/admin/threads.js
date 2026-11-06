// Admin routes for message threads with site owners: start, list, unread count, read, reply and
// mark read. Mounted by api/admin/index.js, behind its admin guards.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const { validate } = require('../../validation/validate');
const {
  startAdminThreadSchema,
  threadMessageSchema,
  listThreadsSchema,
} = require('../../validation/thread');
const {
  THREAD_SELECT,
  toThread,
  unreadWhere,
  listThreads,
  startThread,
  addThreadMessage,
  markThreadRead,
} = require('../../lib/threads');

const router = express.Router();

const THREAD_NOT_FOUND = 'Thread not found.';

// Any site owner's thread, or a 404.
async function findThread(id) {
  const thread = await prisma.thread.findUnique({ where: { id }, select: { id: true } });
  if (!thread) throw new ServerError(404, THREAD_NOT_FOUND);
  return thread;
}

// POST /api/admin/threads — body { accountId, subject, message }. Starts a thread with one active
// site owner, who can reply. Unread for them until they open it.
router.post('/', async (req, res) => {
  const input = validate(startAdminThreadSchema, req.body ?? {});

  const account = await prisma.account.findFirst({
    where: { id: input.accountId, role: 'site_owner', active: true },
    select: { id: true },
  });
  if (!account) throw new ServerError(404, 'Account not found.');

  const thread = await prisma.$transaction((tx) =>
    startThread(tx, req, {
      accountId: account.id,
      subject: input.subject,
      message: input.message,
      side: 'admin',
    }),
  );
  res.status(201).json({ data: toThread(thread, 'admin') });
});

// GET /api/admin/threads — every site owner's threads, newest activity first, a page at a time
// (limit, cursor), each with who started it and whether it has a reply the admin hasn't read.
router.get('/', async (req, res) => {
  const input = validate(listThreadsSchema, req.query);
  res.json(await listThreads({}, input, 'admin'));
});

// GET /api/admin/threads/unreadCount — threads with a message the admin hasn't read, for the
// navbar badge. Registered before /:id so "unreadCount" is never read as an id.
router.get('/unreadCount', async (req, res) => {
  const threads = await prisma.thread.count({ where: unreadWhere('admin') });
  res.json({ data: { threads } });
});

// GET /api/admin/threads/:id — one thread with its messages, oldest first.
router.get('/:id', async (req, res) => {
  const thread = await prisma.thread.findUnique({
    where: { id: req.params.id },
    select: THREAD_SELECT,
  });
  if (!thread) throw new ServerError(404, THREAD_NOT_FOUND);
  res.json({ data: toThread(thread, 'admin') });
});

// POST /api/admin/threads/:id/messages — body { message }. The admin's reply.
router.post('/:id/messages', async (req, res) => {
  const input = validate(threadMessageSchema, req.body ?? {});

  const { id } = await findThread(req.params.id);

  const thread = await prisma.$transaction((tx) =>
    addThreadMessage(tx, req, id, 'admin', input.message),
  );
  res.status(201).json({ data: toThread(thread, 'admin') });
});

// POST /api/admin/threads/:id/read — marks the thread read for the admin.
router.post('/:id/read', async (req, res) => {
  const { id } = await findThread(req.params.id);
  res.json({ data: await markThreadRead(id, 'admin') });
});

module.exports = router;
