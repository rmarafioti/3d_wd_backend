// The admin's Recently Deleted: the list of the sent updates and threads they deleted from their
// mailbox, moving mail into it, and restoring from it. Mounted by api/admin/index.js.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const { validate } = require('../../validation/validate');
const { mailItemsSchema } = require('../../validation/deleted');
const { pageSchema } = require('../../validation/fields');
const {
  ADMIN_MAILBOX_WHERE,
  restorableUpdateWhere,
  setAdminDeleted,
} = require('../../lib/notifications');
const {
  inMailboxWhere,
  restorableWhere: restorableThreadWhere,
  setThreadDeleted,
} = require('../../lib/threads');
const { deletedSource, listDeleted, runPerItem } = require('../../lib/deleted');

const router = express.Router();

const UPDATE_NOT_FOUND = 'Update not found.';
const THREAD_NOT_FOUND = 'Thread not found.';

// The admin's types: their sent updates and threads.
function adminSources() {
  return [
    deletedSource({
      type: 'update',
      model: prisma.notification,
      where: restorableUpdateWhere(),
      deletedAtField: 'adminDeletedAt',
      select: { id: true, title: true, adminDeletedAt: true },
      toItem: (notification) => ({
        id: notification.id,
        name: notification.title,
        websiteId: null,
        websiteName: null,
        deletedAt: notification.adminDeletedAt,
      }),
    }),
    deletedSource({
      type: 'thread',
      model: prisma.thread,
      where: restorableThreadWhere('admin'),
      deletedAtField: 'adminDeletedAt',
      select: { id: true, subject: true, adminDeletedAt: true },
      toItem: (thread) => ({
        id: thread.id,
        name: thread.subject,
        websiteId: null,
        websiteName: null,
        deletedAt: thread.adminDeletedAt,
      }),
    }),
  ];
}

// The update matched by `where`, or a 404.
async function assertUpdateMatching(db, where, id) {
  const update = await db.notification.findFirst({ where: { ...where, id }, select: { id: true } });
  if (!update) throw new ServerError(404, UPDATE_NOT_FOUND);
  return update;
}

// The thread matched by `where`, or a 404.
async function assertThreadMatching(db, where, id) {
  const thread = await db.thread.findFirst({ where: { ...where, id }, select: { id: true } });
  if (!thread) throw new ServerError(404, THREAD_NOT_FOUND);
  return thread;
}

// GET /api/admin/deleted — the admin's Recently Deleted, newest deletion first, a page at a time
// (limit, cursor), each item with when it can no longer be restored.
router.get('/', async (req, res) => {
  const input = validate(pageSchema, req.query);
  res.json(await listDeleted(adminSources(), input));
});

// POST /api/admin/deleted — body { items: [{ type, id }] }, updates and threads. Moves each from
// the admin's mailbox to Recently Deleted, in one transaction. A sent update is hidden from the
// admin only, never withdrawn; site owners keep theirs. An item not in the mailbox is reported in
// `failed` and the rest are still moved.
router.post('/', async (req, res) => {
  const input = validate(mailItemsSchema, req.body ?? {});

  const now = new Date();
  const { done, failed } = await prisma.$transaction((tx) =>
    runPerItem(input.items, {
      update: async (id) => {
        await assertUpdateMatching(tx, ADMIN_MAILBOX_WHERE, id);
        await setAdminDeleted(tx, req, id, now);
      },
      thread: async (id) => {
        await assertThreadMatching(tx, inMailboxWhere('admin'), id);
        await setThreadDeleted(tx, req, id, 'admin', now);
      },
    }),
  );

  res.json({ data: { deleted: done, failed } });
});

// POST /api/admin/deleted/restore — body { items: [{ type, id }] }, updates and threads. Restores
// each one deleted in the last 30 days in its own transaction; one not restorable is reported in
// `failed` and the rest are still restored.
router.post('/restore', async (req, res) => {
  const input = validate(mailItemsSchema, req.body ?? {});

  const { done, failed } = await runPerItem(input.items, {
    update: (id) =>
      prisma.$transaction(async (tx) => {
        await assertUpdateMatching(tx, restorableUpdateWhere(), id);
        await setAdminDeleted(tx, req, id, null);
      }),
    thread: (id) =>
      prisma.$transaction(async (tx) => {
        await assertThreadMatching(tx, restorableThreadWhere('admin'), id);
        await setThreadDeleted(tx, req, id, 'admin', null);
      }),
  });

  res.json({ data: { restored: done, failed } });
});

module.exports = router;
