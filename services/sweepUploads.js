// The upload cleanup (docs/setup.md → Upload cleanup), run by `npm run sweep:uploads`. The
// database is the record of which images are kept: an upload under this environment's root folder
// that is more than 24 hours old and that no kept image row refers to is deleted from Cloudinary.
// An image row is kept while its post is active, archived, or deleted less than 30 days ago. That
// covers images removed in an edit, uploads whose save failed, and the images of deleted posts.
// Image rows are never deleted here. Safe to re-run; it never touches anything outside
// CLOUDINARY_FOLDER.
const prisma = require('../prisma');
const { listUploads, deleteUploads, publicIdFromSrc } = require('../lib/cloudinary');

// Uploads happen at Publish and the save follows straight away, so a day is a wide margin.
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

// A deleted post keeps its images as long as database backups are kept (30 days), so a restored
// backup, or a post recovered after a mistaken delete, still has them.
const DELETED_POST_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

async function sweepUploads() {
  // The trailing "/" keeps 3dwd from matching 3dwd-dev/… and the reverse.
  const uploads = await listUploads(`${process.env.CLOUDINARY_FOLDER}/`);

  const graceCutoff = new Date(Date.now() - DELETED_POST_GRACE_MS);
  const images = await prisma.image.findMany({
    where: { post: { OR: [{ deletedAt: null }, { deletedAt: { gt: graceCutoff } }] } },
    select: { src: true },
  });
  const keptIds = new Set(images.map((image) => publicIdFromSrc(image.src)));

  const cutoff = Date.now() - MIN_AGE_MS;
  const unused = uploads
    .filter((upload) => upload.createdAt.getTime() < cutoff && !keptIds.has(upload.publicId))
    .map((upload) => upload.publicId);

  await deleteUploads(unused);
  return { checked: uploads.length, deleted: unused.length };
}

module.exports = sweepUploads;
