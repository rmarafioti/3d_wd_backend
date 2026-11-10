// Site owner routes for their Inbox updates: list, unread count and mark read. Mounted by
// api/siteOwner/index.js, behind its site owner guards.
const express = require('express');
const prisma = require('../../prisma');
const { validate } = require('../../validation/validate');
const { pageSchema } = require('../../validation/fields');
const {
  NOTIFICATION_SELECT,
  toNotification,
  inboxRecipientWhere,
  assertRecipientMatching,
} = require('../../lib/notifications');
const { unreadWhere, ownerMailboxWhere } = require('../../lib/threads');
const { toPage } = require('../../lib/paging');

const router = express.Router();

const RECIPIENT_SELECT = { readAt: true, notification: { select: NOTIFICATION_SELECT } };

// GET /api/siteOwner/notifications — the account's updates, newest first, a page at a time
// (limit, cursor), each with its readAt.
router.get('/', async (req, res) => {
  const input = validate(pageSchema, req.query);

  // Notification ids are UUIDv7, so time-ordered: the cursor is the last notification id seen.
  // One row more than the page is read to tell whether another page follows.
  const recipients = await prisma.notificationRecipient.findMany({
    where: {
      ...inboxRecipientWhere(req.user.id),
      ...(input.cursor && { notificationId: { lt: input.cursor } }),
    },
    orderBy: { notificationId: 'desc' },
    take: input.limit + 1,
    select: RECIPIENT_SELECT,
  });

  res.json(toPage(recipients, input.limit, toNotification));
});

// GET /api/siteOwner/notifications/unreadCount — unread updates and threads with an unread reply,
// for the navbar badge. Deleted mail is never counted.
router.get('/unreadCount', async (req, res) => {
  const [updates, threads] = await Promise.all([
    prisma.notificationRecipient.count({
      where: { ...inboxRecipientWhere(req.user.id), readAt: null },
    }),
    prisma.thread.count({
      where: { ...ownerMailboxWhere(req.user.id), ...unreadWhere('owner') },
    }),
  ]);
  res.json({ data: { updates, threads } });
});

// POST /api/siteOwner/notifications/:id/read — marks one of the account's updates read. Reading
// it again keeps the first readAt. Not audited: a read changes nothing the admin acts on.
router.post('/:id/read', async (req, res) => {
  const recipient = await assertRecipientMatching(
    prisma,
    inboxRecipientWhere(req.user.id),
    req.params.id,
  );

  await prisma.notificationRecipient.updateMany({
    where: { id: recipient.id, readAt: null },
    data: { readAt: new Date() },
  });
  const read = await prisma.notificationRecipient.findUnique({
    where: { id: recipient.id },
    select: RECIPIENT_SELECT,
  });
  res.json({ data: toNotification(read) });
});

module.exports = router;
