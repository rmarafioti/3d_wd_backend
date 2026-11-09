// Updates from the admin to site owners: their shapes and audit events, sending one with its
// recipients, the automatic ones when an ability or gallery goes live, and deleting either copy.
const { AUDIT_ACTIONS, recordAuditEvent } = require('./audit');
const { restoreCutoff } = require('./retention');

const NOTIFICATION_SELECT = {
  id: true,
  title: true,
  body: true,
  kind: true,
  createdAt: true,
  updatedAt: true,
};

// Updates in the admin's mailbox: not withdrawn, and not deleted by the admin.
const ADMIN_MAILBOX_WHERE = { deletedAt: null, adminDeletedAt: null };

// The admin's view adds how many it was sent to and how many have read it: counts only, never
// who, so the admin doesn't watch who reads what. Only each copy's readAt is read, to count them.
const ADMIN_NOTIFICATION_SELECT = {
  ...NOTIFICATION_SELECT,
  recipients: { select: { readAt: true } },
};

// The automatic updates' wording, by what went live.
const ABILITY_LIVE_MESSAGES = {
  galleries: (websiteName) => ({
    title: 'Your Photo Galleries are now live!',
    body: `Photo Galleries are now part of ${websiteName}. Add a gallery from your dashboard and send its request message to say where it goes.`,
  }),
  posts: (websiteName) => ({
    title: 'Your posts are now live!',
    body: `Your posts now show on ${websiteName}.`,
  }),
};

// A site owner's updates come only through their own recipient rows; a withdrawn update is gone,
// and one they deleted is in their Recently Deleted, not their Inbox.
function inboxRecipientWhere(accountId) {
  return { accountId, deletedAt: null, notification: { deletedAt: null } };
}

// A site owner's copies they deleted in the last 30 days, of updates not withdrawn: their Recently
// Deleted.
function restorableRecipientWhere(accountId) {
  return { accountId, deletedAt: { gt: restoreCutoff() }, notification: { deletedAt: null } };
}

// A site owner's update: the notification with their own recipient row's readAt.
function toNotification({ readAt, notification }) {
  return { ...notification, readAt };
}

function toAdminNotification({ recipients, ...notification }) {
  return {
    ...notification,
    recipientCount: recipients.length,
    readCount: recipients.filter((recipient) => recipient.readAt !== null).length,
  };
}

// An update change's audit event (edit, withdraw, delete, restore), by whoever made it. Never the
// title or body.
function recordNotificationEvent(tx, req, action, notificationId) {
  return recordAuditEvent(tx, req, {
    action,
    actorId: req.user.id,
    actorEmail: req.user.email,
    targetType: 'notification',
    targetId: notificationId,
  });
}

// Deletes one site owner's copy of an update (deletedAt now) or restores it (null), with its
// audit event, inside the caller's transaction. The update and every other copy stay as they are.
async function setRecipientDeleted(tx, req, recipient, deletedAt) {
  await recordNotificationEvent(
    tx,
    req,
    deletedAt ? AUDIT_ACTIONS.NOTIFICATION_DELETED : AUDIT_ACTIONS.NOTIFICATION_RESTORED,
    recipient.notificationId,
  );
  await tx.notificationRecipient.update({
    where: { id: recipient.id },
    data: { deletedAt },
    select: { id: true },
  });
}

// Deletes a sent update from the admin's mailbox (adminDeletedAt now) or restores it (null), with
// its audit event, inside the caller's transaction. Site owners' copies stay as they are.
async function setAdminDeleted(tx, req, notificationId, adminDeletedAt) {
  await recordNotificationEvent(
    tx,
    req,
    adminDeletedAt ? AUDIT_ACTIONS.NOTIFICATION_DELETED : AUDIT_ACTIONS.NOTIFICATION_RESTORED,
    notificationId,
  );
  await tx.notification.update({
    where: { id: notificationId },
    data: { adminDeletedAt },
    select: { id: true },
  });
}

// The update, one recipient row per account and its audit event, written with `tx` inside the
// caller's transaction. The audit event holds the count, never the title or body.
async function sendNotification(tx, req, { title, body, kind, accountIds }) {
  const notification = await tx.notification.create({
    data: {
      title,
      body,
      kind,
      createdById: req.user.id,
      recipients: { createMany: { data: accountIds.map((accountId) => ({ accountId })) } },
    },
    select: { id: true },
  });
  await recordAuditEvent(tx, req, {
    action: AUDIT_ACTIONS.NOTIFICATION_SENT,
    actorId: req.user.id,
    actorEmail: req.user.email,
    targetType: 'notification',
    targetId: notification.id,
    metadata: { recipientCount: accountIds.length, kind },
  });
  return notification;
}

// An automatic update to the active site owners linked to a website. `toMessage` turns the
// website's name into { title, body }. Returns null when there is no one to send it to.
async function notifyWebsiteOwners(tx, req, websiteId, toMessage) {
  const website = await tx.website.findUnique({
    where: { id: websiteId },
    select: {
      websiteName: true,
      accountWebsites: {
        where: { account: { role: 'site_owner', active: true } },
        select: { accountId: true },
      },
    },
  });
  // A website with no active site owner has no one to tell: nothing is sent or audited.
  if (website.accountWebsites.length === 0) return null;
  return sendNotification(tx, req, {
    ...toMessage(website.websiteName),
    kind: 'automatic',
    accountIds: website.accountWebsites.map((link) => link.accountId),
  });
}

function galleryLiveMessage(galleryName) {
  return (websiteName) => ({
    title: 'Your gallery is on your website',
    body: `"${galleryName}" is now live on ${websiteName}.`,
  });
}

module.exports = {
  NOTIFICATION_SELECT,
  ADMIN_NOTIFICATION_SELECT,
  ADMIN_MAILBOX_WHERE,
  ABILITY_LIVE_MESSAGES,
  toNotification,
  toAdminNotification,
  recordNotificationEvent,
  inboxRecipientWhere,
  restorableRecipientWhere,
  setRecipientDeleted,
  setAdminDeleted,
  sendNotification,
  notifyWebsiteOwners,
  galleryLiveMessage,
};
