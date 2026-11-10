// The site owner's Recently Deleted: the list of their deleted posts, galleries, updates and
// threads, moving mail into it, and restoring from it. Mounted by api/siteOwner/index.js.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const { validate } = require('../../validation/validate');
const { mailItemsSchema, allItemsSchema } = require('../../validation/deleted');
const { pageSchema } = require('../../validation/fields');
const { restorablePostWhere, restorableGalleryWhere } = require('../../lib/ownership');
const {
  inboxRecipientWhere,
  restorableRecipientWhere,
  assertRecipientMatching,
  setRecipientDeleted,
} = require('../../lib/notifications');
const {
  ownerMailboxWhere,
  restorableWhere: restorableThreadWhere,
  setThreadDeleted,
} = require('../../lib/threads');
const { restorePost, restoreGallery } = require('../../lib/restore');
const { deletedSource, listDeleted, runPerItem } = require('../../lib/deleted');
const revalidate = require('../../services/revalidate');

const router = express.Router();

const THREAD_NOT_FOUND = 'Thread not found.';

const WEBSITE_NAME_SELECT = { select: { websiteName: true } };

// Each type's sources for one account. A post or gallery names its website; mail has none.
function siteOwnerSources(accountId) {
  return [
    deletedSource({
      type: 'post',
      model: prisma.post,
      where: restorablePostWhere(accountId),
      select: {
        id: true,
        postName: true,
        websiteId: true,
        deletedAt: true,
        website: WEBSITE_NAME_SELECT,
      },
      toItem: (post) => ({
        id: post.id,
        name: post.postName,
        websiteId: post.websiteId,
        websiteName: post.website.websiteName,
        deletedAt: post.deletedAt,
      }),
    }),
    deletedSource({
      type: 'gallery',
      model: prisma.gallery,
      where: restorableGalleryWhere(accountId),
      select: {
        id: true,
        galleryName: true,
        websiteId: true,
        deletedAt: true,
        website: WEBSITE_NAME_SELECT,
      },
      toItem: (gallery) => ({
        id: gallery.id,
        name: gallery.galleryName,
        websiteId: gallery.websiteId,
        websiteName: gallery.website.websiteName,
        deletedAt: gallery.deletedAt,
      }),
    }),
    // An update is restored by its notification id, as it is read, so that is its id here.
    deletedSource({
      type: 'update',
      model: prisma.notificationRecipient,
      where: restorableRecipientWhere(accountId),
      idField: 'notificationId',
      select: { notificationId: true, deletedAt: true, notification: { select: { title: true } } },
      toItem: (recipient) => ({
        id: recipient.notificationId,
        name: recipient.notification.title,
        websiteId: null,
        websiteName: null,
        deletedAt: recipient.deletedAt,
      }),
    }),
    deletedSource({
      type: 'thread',
      model: prisma.thread,
      where: { accountId, ...restorableThreadWhere('owner') },
      deletedAtField: 'ownerDeletedAt',
      select: { id: true, subject: true, ownerDeletedAt: true },
      toItem: (thread) => ({
        id: thread.id,
        name: thread.subject,
        websiteId: null,
        websiteName: null,
        deletedAt: thread.ownerDeletedAt,
      }),
    }),
  ];
}

// The account's thread matched by `where`, or a 404.
async function assertThreadMatching(db, where, id) {
  const thread = await db.thread.findFirst({ where: { ...where, id }, select: { id: true } });
  if (!thread) throw new ServerError(404, THREAD_NOT_FOUND);
  return thread;
}

// GET /api/siteOwner/deleted — the account's Recently Deleted, newest deletion first, a page at a
// time (limit, cursor), each item with when it can no longer be restored.
router.get('/', async (req, res) => {
  const input = validate(pageSchema, req.query);
  res.json(await listDeleted(siteOwnerSources(req.user.id), input));
});

// POST /api/siteOwner/deleted — body { items: [{ type, id }] }, updates and threads. Moves each
// from the site owner's mailbox to Recently Deleted, in one transaction; the admin's copy stays.
// An item not in the mailbox is reported in `failed` and the rest are still moved.
router.post('/', async (req, res) => {
  const input = validate(mailItemsSchema, req.body ?? {});

  const accountId = req.user.id;
  const now = new Date();
  const { done, failed } = await prisma.$transaction((tx) =>
    runPerItem(input.items, {
      update: async (id) => {
        const recipient = await assertRecipientMatching(tx, inboxRecipientWhere(accountId), id);
        await setRecipientDeleted(tx, req, recipient, now);
      },
      thread: async (id) => {
        await assertThreadMatching(tx, ownerMailboxWhere(accountId), id);
        await setThreadDeleted(tx, req, id, 'owner', now);
      },
    }),
  );

  res.json({ data: { deleted: done, failed } });
});

// POST /api/siteOwner/deleted/restore — body { items: [{ type, id }] }, any type. Restores each
// item deleted in the last 30 days in its own transaction, so one that fails (a gallery whose name
// is taken since) is reported in `failed` and the rest are still restored.
router.post('/restore', async (req, res) => {
  const input = validate(allItemsSchema, req.body ?? {});

  const accountId = req.user.id;
  // One revalidation per website a restored post or gallery is on: the client website refreshes
  // its whole cms tag, whichever item the call names.
  const revalidations = new Map();
  const { done, failed } = await runPerItem(input.items, {
    post: async (id) => {
      const post = await restorePost(req, id);
      if (!revalidations.has(post.websiteId)) revalidations.set(post.websiteId, { postId: id });
    },
    gallery: async (id) => {
      const gallery = await restoreGallery(req, id);
      if (!revalidations.has(gallery.websiteId)) {
        revalidations.set(gallery.websiteId, { galleryId: id });
      }
    },
    update: (id) =>
      prisma.$transaction(async (tx) => {
        const recipient = await assertRecipientMatching(
          tx,
          restorableRecipientWhere(accountId),
          id,
        );
        await setRecipientDeleted(tx, req, recipient, null);
      }),
    thread: (id) =>
      prisma.$transaction(async (tx) => {
        await assertThreadMatching(tx, { accountId, ...restorableThreadWhere('owner') }, id);
        await setThreadDeleted(tx, req, id, 'owner', null);
      }),
  });

  res.json({ data: { restored: done, failed } });
  // After commit and after responding; never awaited, never throws (services/revalidate.js).
  for (const [websiteId, changed] of revalidations) revalidate(websiteId, changed);
});

module.exports = router;
