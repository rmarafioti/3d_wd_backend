// A gallery's name rule: unique on its website among galleries not deleted, in any case, kept so
// under concurrent creates and restores by Serializable transactions and a retry (lib/retry.js).
const { ServerError } = require('../errors');

const GALLERY_NAME_TAKEN = 'A gallery with this name already exists.';

// Throws the 409 when another gallery on the website, not deleted, has this name in any case:
// two galleries with one name can't be told apart on the dashboard. `exceptId` is the gallery
// being edited or restored, which may keep its own name.
async function assertNameAvailable(tx, websiteId, galleryName, exceptId) {
  const taken = await tx.gallery.findFirst({
    where: {
      websiteId,
      deletedAt: null,
      galleryName: { equals: galleryName, mode: 'insensitive' },
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { id: true },
  });
  if (taken) throw new ServerError(409, GALLERY_NAME_TAKEN);
}

module.exports = { assertNameAvailable };
