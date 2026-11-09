// The site owner ownership checks shared by the post and gallery routes (CLAUDE.md → Role Ownership
// Check Rule): the owned website, restorable posts and galleries, own images and image ids.
const { ServerError } = require('../errors');
const { isInFolder } = require('./cloudinary');
const { restoreCutoff } = require('./retention');

const INVALID_IMAGE = 'Invalid image.';

// The Prisma `where` for "an active website linked to this account".
function ownedWebsiteWhere(accountId) {
  return { active: true, accountWebsites: { some: { accountId } } };
}

// The account's posts deleted in the last 30 days, which Restore a Post and Recently Deleted read.
function restorablePostWhere(accountId) {
  return { deletedAt: { gt: restoreCutoff() }, website: ownedWebsiteWhere(accountId) };
}

// The account's galleries deleted in the last 30 days, on a website that still has Photo Galleries:
// galleries deleted by removing it come back by adding it again, not one at a time.
function restorableGalleryWhere(accountId) {
  return {
    deletedAt: { gt: restoreCutoff() },
    website: {
      ...ownedWebsiteWhere(accountId),
      abilities: { some: { kind: 'galleries', removedAt: null } },
    },
  };
}

// Every image id sent on an edit must already belong to the post or gallery being edited, and
// appear only once. Stops a site owner editing another post's or gallery's images by guessing ids.
function assertOwnImages(images, storedImages) {
  const storedIds = new Set(storedImages.map((image) => image.id));
  const seen = new Set();
  for (const { id } of images) {
    if (id === undefined) continue;
    if (!storedIds.has(id) || seen.has(id)) {
      throw new ServerError(400, INVALID_IMAGE);
    }
    seen.add(id);
  }
}

// Every image src must be a Cloudinary upload in the website's own folder (lib/cloudinary.js).
// Stops a post or gallery showing an image from anywhere else, including another website's folder.
function assertImagesInFolder(images, mediaFolder) {
  if (images.some((image) => !isInFolder(image.src, mediaFolder))) {
    throw new ServerError(400, INVALID_IMAGE);
  }
}

module.exports = {
  ownedWebsiteWhere,
  restorablePostWhere,
  restorableGalleryWhere,
  assertOwnImages,
  assertImagesInFolder,
};
