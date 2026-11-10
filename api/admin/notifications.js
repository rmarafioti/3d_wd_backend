// Admin routes for site-wide updates to site owners: send, list, edit and withdraw. Mounted by
// api/admin/index.js, behind its admin guards.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const { validate } = require('../../validation/validate');
const { notificationSchema } = require('../../validation/notification');
const { pageSchema } = require('../../validation/fields');
const { AUDIT_ACTIONS } = require('../../lib/audit');
const { toPage } = require('../../lib/paging');
const {
  ADMIN_NOTIFICATION_SELECT,
  toAdminNotification,
  ADMIN_MAILBOX_WHERE,
  recordNotificationEvent,
  sendNotification,
} = require('../../lib/notifications');

const router = express.Router();

const UPDATE_NOT_FOUND = 'Update not found.';

// An update in the admin's mailbox, or a 404.
async function assertSentNotification(id) {
  const notification = await prisma.notification.findFirst({
    where: { id, ...ADMIN_MAILBOX_WHERE },
    select: { id: true },
  });
  if (!notification) throw new ServerError(404, UPDATE_NOT_FOUND);
  return notification;
}

// POST /api/admin/notifications — body { title, body }. Sends a site-wide update to every active
// site owner. It can't be replied to; a message to one site owner is a thread. Recipients are
// fixed now: an account created later never receives it.
router.post('/', async (req, res) => {
  const input = validate(notificationSchema, req.body ?? {});

  const accounts = await prisma.account.findMany({
    where: { role: 'site_owner', active: true },
    select: { id: true },
  });

  const notification = await prisma.$transaction(async (tx) => {
    const sent = await sendNotification(tx, req, {
      title: input.title,
      body: input.body,
      kind: 'general',
      accountIds: accounts.map((account) => account.id),
    });
    return tx.notification.findUnique({
      where: { id: sent.id },
      select: ADMIN_NOTIFICATION_SELECT,
    });
  });

  res.status(201).json({ data: toAdminNotification(notification) });
});

// GET /api/admin/notifications — the updates in the admin's mailbox, newest first, a page at a time
// (limit, cursor), each with its recipients and how many have read it.
router.get('/', async (req, res) => {
  const input = validate(pageSchema, req.query);

  // UUIDv7 ids are time-ordered, so the cursor is the last id seen. One row more than the page is
  // read to tell whether another page follows.
  const notifications = await prisma.notification.findMany({
    where: { ...ADMIN_MAILBOX_WHERE, ...(input.cursor && { id: { lt: input.cursor } }) },
    orderBy: { id: 'desc' },
    take: input.limit + 1,
    select: ADMIN_NOTIFICATION_SELECT,
  });

  res.json(toPage(notifications, input.limit, toAdminNotification));
});

// PATCH /api/admin/notifications/:id — body { title, body }. Edits a sent update. Its recipients
// and their read state stay as they are.
router.patch('/:id', async (req, res) => {
  const input = validate(notificationSchema, req.body ?? {});

  const { id } = await assertSentNotification(req.params.id);

  const notification = await prisma.$transaction(async (tx) => {
    await recordNotificationEvent(tx, req, AUDIT_ACTIONS.NOTIFICATION_UPDATED, id);
    return tx.notification.update({
      where: { id },
      data: { title: input.title, body: input.body },
      select: ADMIN_NOTIFICATION_SELECT,
    });
  });

  res.json({ data: toAdminNotification(notification) });
});

// DELETE /api/admin/notifications/:id — withdraws an update: deletedAt is set (never a hard
// delete), and it is gone from every inbox and every route.
router.delete('/:id', async (req, res) => {
  const { id } = await assertSentNotification(req.params.id);

  await prisma.$transaction(async (tx) => {
    await recordNotificationEvent(tx, req, AUDIT_ACTIONS.NOTIFICATION_WITHDRAWN, id);
    await tx.notification.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  });

  res.status(204).end();
});

module.exports = router;
