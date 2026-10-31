// The site owner ownership checks shared by the post and gallery routes (CLAUDE.md → Role
// Ownership Check Rule). The account always comes from req.user, never from the request. A website
// belongs to the site owner when an account_website row links them AND the website is active.
// Images sent with a post or gallery must be the website's own uploads, and an image id sent on an
// edit must already be one of that post's or gallery's images.
const { ServerError } = require('../errors');
const { isInFolder } = require('./cloudinary');

const INVALID_IMAGE = 'Invalid image.';

// The Prisma `where` for "an active website linked to this account".
function ownedWebsiteWhere(accountId) {
  return { active: true, accountWebsites: { some: { accountId } } };
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

module.exports = { ownedWebsiteWhere, assertOwnImages, assertImagesInFolder };
