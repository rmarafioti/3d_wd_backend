// Site owner gallery routes, mounted at /api/siteOwner/galleries by api/siteOwner/index.js after
// its requireAuth and requireRole('site_owner') guards: create, read, edit, draft or publish, and
// delete a photo gallery. Every change writes its audit event (lib/audit.js) inside the same
// transaction, then revalidates the client website after commit.
//
// Ownership (lib/ownership.js): a gallery belongs to the site owner when its website does and it
// isn't deleted. Anything else is a 404 "Gallery not found.", identical to "doesn't exist".
// A gallery's slug is made once at create (lib/slug.js) and never changes. A gallery's name is
// unique among the website's galleries that aren't deleted, ignoring case: two galleries with the
// same name would be impossible to tell apart on the dashboard. The frontend checks it first.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const { validate } = require('../../validation/validate');
const {
  createGallerySchema,
  updateGallerySchema,
  galleryStatusSchema,
} = require('../../validation/gallery');
const { ownedWebsiteWhere, assertOwnImages, assertImagesInFolder } = require('../../lib/ownership');
const { findFreeSlug } = require('../../lib/slug');
const { CROP_SELECT, toCropColumns, toCrop } = require('../../lib/galleryImages');
const { AUDIT_ACTIONS, recordAuditEvent } = require('../../lib/audit');
const revalidate = require('../../services/revalidate');

const router = express.Router();

const GALLERY_NOT_FOUND = 'Gallery not found.';
const WEBSITE_NOT_FOUND = 'Website not found.';
const GALLERY_NAME_TAKEN = 'A gallery with this name already exists.';

// Images are ordered by position.
const GALLERY_SELECT = {
  id: true,
  websiteId: true,
  galleryName: true,
  slug: true,
  title: true,
  copy: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  website: { select: { websiteName: true } },
  images: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      src: true,
      width: true,
      height: true,
      altText: true,
      caption: true,
      ...CROP_SELECT,
    },
  },
};

function findOwnedGallery(accountId, galleryId, select) {
  return prisma.gallery.findFirst({
    where: { id: galleryId, deletedAt: null, website: ownedWebsiteWhere(accountId) },
    select,
  });
}

// Prisma row (selected with GALLERY_SELECT) → the contract's Gallery shape.
function toGallery(gallery) {
  return {
    id: gallery.id,
    websiteId: gallery.websiteId,
    websiteName: gallery.website.websiteName,
    galleryName: gallery.galleryName,
    slug: gallery.slug,
    title: gallery.title,
    copy: gallery.copy,
    status: gallery.status,
    createdAt: gallery.createdAt,
    updatedAt: gallery.updatedAt,
    images: gallery.images.map((image) => ({
      id: image.id,
      src: image.src,
      width: image.width,
      height: image.height,
      altText: image.altText,
      caption: image.caption,
      thumbnailCrop: toCrop(image, 'thumbnail'),
      mobileCrop: toCrop(image, 'mobile'),
    })),
  };
}

// Writes a gallery's images inside a transaction, in list order: an image with an id is updated
// (its position included), one without is inserted.
async function writeImages(tx, galleryId, images) {
  for (const [position, { id, thumbnailCrop, mobileCrop, ...image }] of images.entries()) {
    const data = { ...image, position, ...toCropColumns({ thumbnailCrop, mobileCrop }) };
    if (id) {
      await tx.galleryImage.update({ where: { id }, data });
      continue;
    }
    await tx.galleryImage.create({ data: { ...data, galleryId } });
  }
}

// Throws the 409 when another gallery on the website, not deleted, has this name in any case.
// `exceptId` is the gallery being edited, which may keep its own name.
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

// Gallery, then images, in one transaction: if any insert fails the whole create rolls back.
function createGallery(req, website, input) {
  return prisma.$transaction(async (tx) => {
    await assertNameAvailable(tx, website.id, input.galleryName);
    const created = await tx.gallery.create({
      data: {
        websiteId: website.id,
        galleryName: input.galleryName,
        slug: await findFreeSlug(tx, website.id, input.galleryName),
        title: input.title,
        copy: input.copy,
        status: input.status,
      },
      select: { id: true, websiteId: true },
    });
    await writeImages(tx, created.id, input.images);
    await recordGalleryEvent(tx, req, AUDIT_ACTIONS.GALLERY_CREATED, created);
    return tx.gallery.findUnique({ where: { id: created.id }, select: GALLERY_SELECT });
  });
}

// A gallery change's audit event, written with the transaction client that made the change.
function recordGalleryEvent(tx, req, action, gallery) {
  return recordAuditEvent(tx, req, {
    action,
    actorId: req.user.id,
    actorEmail: req.user.email,
    targetType: 'gallery',
    targetId: gallery.id,
    metadata: { websiteId: gallery.websiteId },
  });
}

// POST /api/siteOwner/galleries — create a gallery with its images.
router.post('/', async (req, res) => {
  const input = validate(createGallerySchema, req.body ?? {});

  const website = await prisma.website.findFirst({
    where: { id: input.websiteId, ...ownedWebsiteWhere(req.user.id) },
    select: { id: true, mediaFolder: true },
  });
  if (!website) throw new ServerError(404, WEBSITE_NOT_FOUND);

  assertImagesInFolder(input.images, website.mediaFolder);

  // Two creates at the same moment can pick the same free slug, and the second then fails the
  // (websiteId, slug) unique index (P2002). It is retried once: with the first now committed, the
  // retry either answers the 409 (same name) or picks the next free slug (a name that makes the
  // same slug, "Art!" and "art").
  let gallery;
  try {
    gallery = await createGallery(req, website, input);
  } catch (err) {
    if (err.code !== 'P2002') throw err;
    gallery = await createGallery(req, website, input);
  }

  res.status(201).json({ data: toGallery(gallery) });
  // After commit and after responding; never awaited, never throws (services/revalidate.js).
  revalidate(website.id, { galleryId: gallery.id });
});

// GET /api/siteOwner/galleries/:id — one gallery with its images.
router.get('/:id', async (req, res) => {
  const gallery = await findOwnedGallery(req.user.id, req.params.id, GALLERY_SELECT);
  if (!gallery) throw new ServerError(404, GALLERY_NOT_FOUND);
  res.json({ data: toGallery(gallery) });
});

// PATCH /api/siteOwner/galleries/:id — full edit form: the gallery's fields plus the complete
// image list. websiteId, status and slug can't be changed here.
router.patch('/:id', async (req, res) => {
  const input = validate(updateGallerySchema, req.body ?? {});

  const gallery = await findOwnedGallery(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
    website: { select: { mediaFolder: true } },
    images: { select: { id: true } },
  });
  if (!gallery) throw new ServerError(404, GALLERY_NOT_FOUND);

  assertOwnImages(input.images, gallery.images);
  assertImagesInFolder(input.images, gallery.website.mediaFolder);
  const keptImageIds = input.images.filter((image) => image.id).map((image) => image.id);

  // Stored images missing from the list are deleted, then writeImages updates the kept ones in
  // their new order and inserts the new ones. If any part fails, nothing is changed.
  const updated = await prisma.$transaction(async (tx) => {
    await assertNameAvailable(tx, gallery.websiteId, input.galleryName, gallery.id);
    await tx.gallery.update({
      where: { id: gallery.id },
      data: { galleryName: input.galleryName, title: input.title, copy: input.copy },
    });
    await tx.galleryImage.deleteMany({
      where: { galleryId: gallery.id, id: { notIn: keptImageIds } },
    });
    await writeImages(tx, gallery.id, input.images);
    await recordGalleryEvent(tx, req, AUDIT_ACTIONS.GALLERY_UPDATED, gallery);
    return tx.gallery.findUnique({ where: { id: gallery.id }, select: GALLERY_SELECT });
  });

  res.json({ data: toGallery(updated) });
  revalidate(gallery.websiteId, { galleryId: gallery.id });
});

// PATCH /api/siteOwner/galleries/:id/status — set a gallery to draft or published. A draft is
// hidden from the client website; the site owner still sees it.
router.patch('/:id/status', async (req, res) => {
  const { status } = validate(galleryStatusSchema, req.body ?? {});

  const gallery = await findOwnedGallery(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
  });
  if (!gallery) throw new ServerError(404, GALLERY_NOT_FOUND);

  const action =
    status === 'published' ? AUDIT_ACTIONS.GALLERY_PUBLISHED : AUDIT_ACTIONS.GALLERY_DRAFTED;
  const updated = await prisma.$transaction(async (tx) => {
    await recordGalleryEvent(tx, req, action, gallery);
    return tx.gallery.update({
      where: { id: gallery.id },
      data: { status },
      select: GALLERY_SELECT,
    });
  });

  res.json({ data: toGallery(updated) });
  revalidate(gallery.websiteId, { galleryId: gallery.id });
});

// DELETE /api/siteOwner/galleries/:id — soft delete: stamps deletedAt, so the gallery is gone
// from the site owner's view and the client website but stays in the database. The upload cleanup
// deletes its images 30 days later (services/sweepUploads.js).
router.delete('/:id', async (req, res) => {
  const gallery = await findOwnedGallery(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
  });
  if (!gallery) throw new ServerError(404, GALLERY_NOT_FOUND);

  await prisma.$transaction(async (tx) => {
    await recordGalleryEvent(tx, req, AUDIT_ACTIONS.GALLERY_DELETED, gallery);
    await tx.gallery.update({ where: { id: gallery.id }, data: { deletedAt: new Date() } });
  });

  res.status(204).end();
  revalidate(gallery.websiteId, { galleryId: gallery.id });
});

module.exports = router;
