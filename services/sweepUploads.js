// The upload cleanup (docs/setup.md → Upload cleanup), run by `npm run sweep:uploads`. The
// database is the record of which images are kept: an upload under this environment's root folder
// that is more than 24 hours old and that no image row refers to (on an active or archived post)
// is deleted from Cloudinary. That covers images removed in an edit and uploads whose save failed.
// Safe to re-run; it never touches anything outside CLOUDINARY_FOLDER.
const prisma = require('../prisma');
const { listUploads, deleteUploads, publicIdFromSrc } = require('../lib/cloudinary');

// Uploads happen at Publish and the save follows straight away, so a day is a wide margin.
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

async function sweepUploads() {
  // The trailing "/" keeps 3dwd from matching 3dwd-dev/… and the reverse.
  const uploads = await listUploads(`${process.env.CLOUDINARY_FOLDER}/`);

  const images = await prisma.image.findMany({ select: { src: true } });
  const keptIds = new Set(images.map((image) => publicIdFromSrc(image.src)));

  const cutoff = Date.now() - MIN_AGE_MS;
  const unused = uploads
    .filter((upload) => upload.createdAt.getTime() < cutoff && !keptIds.has(upload.publicId))
    .map((upload) => upload.publicId);

  await deleteUploads(unused);
  return { checked: uploads.length, deleted: unused.length };
}

module.exports = sweepUploads;
