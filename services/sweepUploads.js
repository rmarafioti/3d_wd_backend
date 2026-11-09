// The upload cleanup run by `npm run sweep:uploads`: deletes this environment's Cloudinary uploads
// that no kept image row refers to (docs/setup.md → Upload cleanup).
const prisma = require('../prisma');
const { listUploads, deleteUploads, publicIdFromSrc } = require('../lib/cloudinary');
const { restoreCutoff } = require('../lib/retention');

// Uploads happen at Publish and the save follows straight away, so a day is a wide margin.
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

async function sweepUploads() {
  // The trailing "/" keeps 3dwd from matching 3dwd-dev/… and the reverse.
  const uploads = await listUploads(`${process.env.CLOUDINARY_FOLDER}/`);

  // A deleted post or gallery keeps its images while it can still be restored (30 days).
  const graceCutoff = restoreCutoff();
  const isKept = { OR: [{ deletedAt: null }, { deletedAt: { gt: graceCutoff } }] };
  const [postImages, galleryImages] = await Promise.all([
    prisma.image.findMany({ where: { post: isKept }, select: { src: true } }),
    prisma.galleryImage.findMany({ where: { gallery: isKept }, select: { src: true } }),
  ]);
  const keptIds = new Set(
    [...postImages, ...galleryImages].map((image) => publicIdFromSrc(image.src)),
  );

  const cutoff = Date.now() - MIN_AGE_MS;
  const unused = uploads
    .filter((upload) => upload.createdAt.getTime() < cutoff && !keptIds.has(upload.publicId))
    .map((upload) => upload.publicId);

  await deleteUploads(unused);
  return { checked: uploads.length, deleted: unused.length };
}

module.exports = sweepUploads;
