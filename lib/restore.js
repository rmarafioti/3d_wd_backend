// Restoring a site owner's deleted post or gallery from Recently Deleted: the restorable check,
// the gallery's name rule, and the audit event, each in its own transaction.
const prisma = require('../prisma');
const { ServerError } = require('../errors');
const { AUDIT_ACTIONS, recordAuditEvent } = require('./audit');
const { restorablePostWhere, restorableGalleryWhere } = require('./ownership');
const { assertNameAvailable, retryOnClash } = require('./galleryNames');

const POST_NOT_FOUND = 'Post not found.';
const GALLERY_NOT_FOUND = 'Gallery not found.';

function recordRestoredEvent(tx, req, action, targetType, row) {
  return recordAuditEvent(tx, req, {
    action,
    actorId: req.user.id,
    actorEmail: req.user.email,
    targetType,
    targetId: row.id,
    metadata: { websiteId: row.websiteId },
  });
}

// Brings back a post the account deleted in the last 30 days, with its body, images and status;
// posts placement is left as it is. Returns { id, websiteId }, or throws the 404.
async function restorePost(req, postId) {
  const post = await prisma.post.findFirst({
    where: { id: postId, ...restorablePostWhere(req.user.id) },
    select: { id: true, websiteId: true },
  });
  if (!post) throw new ServerError(404, POST_NOT_FOUND);

  await prisma.$transaction(async (tx) => {
    await recordRestoredEvent(tx, req, AUDIT_ACTIONS.POST_RESTORED, 'post', post);
    await tx.post.update({
      where: { id: post.id },
      data: { deletedAt: null },
      select: { id: true },
    });
  });
  return post;
}

// Brings back a gallery the account deleted in the last 30 days, with its images, crops, status and
// placement. Serializable, as a create is, since it takes its name back: a gallery created since
// with that name throws the 409. Returns { id, websiteId }, or throws the 404.
async function restoreGallery(req, galleryId) {
  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ...restorableGalleryWhere(req.user.id) },
    select: { id: true, websiteId: true, galleryName: true },
  });
  if (!gallery) throw new ServerError(404, GALLERY_NOT_FOUND);

  await retryOnClash(() =>
    prisma.$transaction(
      async (tx) => {
        await assertNameAvailable(tx, gallery.websiteId, gallery.galleryName, gallery.id);
        await recordRestoredEvent(tx, req, AUDIT_ACTIONS.GALLERY_RESTORED, 'gallery', gallery);
        await tx.gallery.update({
          where: { id: gallery.id },
          data: { deletedAt: null },
          select: { id: true },
        });
      },
      { isolationLevel: 'Serializable' },
    ),
  );
  return { id: gallery.id, websiteId: gallery.websiteId };
}

module.exports = { restorePost, restoreGallery };
