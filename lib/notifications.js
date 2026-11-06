// Updates from the admin to site owners: their shapes, sending one with its recipients and audit
// event, and the automatic updates written when the admin sets an ability or a gallery live.
const { AUDIT_ACTIONS, recordAuditEvent } = require('./audit');

const NOTIFICATION_SELECT = {
  id: true,
  title: true,
  body: true,
  kind: true,
  createdAt: true,
  updatedAt: true,
};

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
  ABILITY_LIVE_MESSAGES,
  toNotification,
  toAdminNotification,
  sendNotification,
  notifyWebsiteOwners,
  galleryLiveMessage,
};
