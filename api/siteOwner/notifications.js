// Site owner routes for their Inbox updates: list, unread count and mark read. Mounted by
// api/siteOwner/index.js, behind its site owner guards.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const { validate } = require('../../validation/validate');
const { listNotificationsSchema } = require('../../validation/notification');
const {
  NOTIFICATION_SELECT,
  toNotification,
  inboxRecipientWhere,
} = require('../../lib/notifications');
const { unreadWhere, inMailboxWhere } = require('../../lib/threads');

const router = express.Router();

const NOTIFICATION_NOT_FOUND = 'Update not found.';

const RECIPIENT_SELECT = { readAt: true, notification: { select: NOTIFICATION_SELECT } };

// GET /api/siteOwner/notifications — the account's updates, newest first, a page at a time
// (limit, cursor), each with its readAt.
router.get('/', async (req, res) => {
  const input = validate(listNotificationsSchema, req.query);

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

  const hasNextPage = recipients.length > input.limit;
  const data = (hasNextPage ? recipients.slice(0, input.limit) : recipients).map(toNotification);
  res.json({ data, nextCursor: hasNextPage ? data.at(-1).id : null });
});

// GET /api/siteOwner/notifications/unreadCount — unread updates and threads with an unread reply,
// for the navbar badge. Deleted mail is never counted.
router.get('/unreadCount', async (req, res) => {
  const [updates, threads] = await Promise.all([
    prisma.notificationRecipient.count({
      where: { ...inboxRecipientWhere(req.user.id), readAt: null },
    }),
    prisma.thread.count({
      where: { accountId: req.user.id, ...inMailboxWhere('owner'), ...unreadWhere('owner') },
    }),
  ]);
  res.json({ data: { updates, threads } });
});

// POST /api/siteOwner/notifications/:id/read — marks one of the account's updates read. Reading
// it again keeps the first readAt. Not audited: a read changes nothing the admin acts on.
router.post('/:id/read', async (req, res) => {
  const recipient = await prisma.notificationRecipient.findFirst({
    where: { ...inboxRecipientWhere(req.user.id), notificationId: req.params.id },
    select: { id: true },
  });
  if (!recipient) throw new ServerError(404, NOTIFICATION_NOT_FOUND);

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
