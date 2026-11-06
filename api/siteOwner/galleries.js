// Site owner gallery routes, mounted at /api/siteOwner/galleries: create, read, edit, draft or
// publish, set its publish date, and delete a photo gallery, and send or edit its request message.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const { validate } = require('../../validation/validate');
const {
  createGallerySchema,
  updateGallerySchema,
  galleryStatusSchema,
  requestGallerySchema,
} = require('../../validation/gallery');
const { publishAtSchema, assertPublishAtAllowed } = require('../../validation/fields');
const { ownedWebsiteWhere, assertOwnImages, assertImagesInFolder } = require('../../lib/ownership');
const { findFreeSlug } = require('../../lib/slug');
const { CROP_SELECT, toCropColumns, toCrop } = require('../../lib/galleryImages');
const { AUDIT_ACTIONS, recordAuditEvent } = require('../../lib/audit');
const { toStatusData } = require('../../lib/status');
const revalidate = require('../../services/revalidate');
const sendRequestEmail = require('../../services/requestEmail');

const router = express.Router();

const GALLERY_NOT_FOUND = 'Gallery not found.';
const WEBSITE_NOT_FOUND = 'Website not found.';
const GALLERY_NAME_TAKEN = 'A gallery with this name already exists.';
const ADD_GALLERIES_FIRST = 'Add Photo Galleries to this website first.';
const ALREADY_REQUESTED = 'This gallery has already been requested.';
const NOT_REQUESTED = "This gallery hasn't been requested yet.";
// Two creates at once can both fail their first try and clash again on the retry, so a create is
// tried up to this many times before its clash is a 500.
const MAX_CREATE_ATTEMPTS = 3;

// The gallery fields the request routes check.
const REQUEST_CHECK_SELECT = { id: true, websiteId: true, requestedAt: true };

// Images are ordered by position.
const GALLERY_SELECT = {
  id: true,
  websiteId: true,
  galleryName: true,
  slug: true,
  title: true,
  copy: true,
  status: true,
  placement: true,
  requestNote: true,
  requestedAt: true,
  publishAt: true,
  publishedAt: true,
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
    placement: gallery.placement,
    requestNote: gallery.requestNote,
    requestedAt: gallery.requestedAt,
    publishAt: gallery.publishAt,
    publishedAt: gallery.publishedAt,
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

// Throws the 409 when another gallery on the website, not deleted, has this name in any case:
// two galleries with one name can't be told apart on the dashboard. `exceptId` is the gallery
// being edited, which may keep its own name.
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

// A create that lost to a concurrent one: a serialization failure (Postgres 40001, which the pg
// driver adapter raises at commit as TransactionWriteConflict, or Prisma's P2034) or a unique
// index clash (P2002).
function isCreateClash(err) {
  return (
    err.code === 'P2002' || err.code === 'P2034' || err.cause?.kind === 'TransactionWriteConflict'
  );
}

// Gallery, then images, in one transaction: if any insert fails the whole create rolls back.
// Serializable, so two creates of the same name at once can't both pass the name check: Postgres
// fails one of them, and the retry (createGalleryRetrying) then answers the 409.
function createGallery(req, website, input) {
  return prisma.$transaction(
    async (tx) => {
      await assertNameAvailable(tx, website.id, input.galleryName);
      const created = await tx.gallery.create({
        data: {
          websiteId: website.id,
          galleryName: input.galleryName,
          slug: await findFreeSlug(tx, website.id),
          title: input.title,
          copy: input.copy,
          status: input.status,
          publishAt: input.publishAt ?? null,
          publishedAt: input.status === 'published' ? new Date() : null,
        },
        select: { id: true, websiteId: true },
      });
      await writeImages(tx, created.id, input.images);
      await recordGalleryEvent(tx, req, AUDIT_ACTIONS.GALLERY_CREATED, created);
      return tx.gallery.findUnique({ where: { id: created.id }, select: GALLERY_SELECT });
    },
    { isolationLevel: 'Serializable' },
  );
}

// createGallery, tried again while it clashes with a concurrent create (isCreateClash). Once the
// other has committed, a retry answers the 409 for the same name, or saves a different name with
// its own slug.
async function createGalleryRetrying(req, website, input) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await createGallery(req, website, input);
    } catch (err) {
      if (!isCreateClash(err) || attempt === MAX_CREATE_ATTEMPTS) throw err;
    }
  }
}

// POST /api/siteOwner/galleries — create a gallery with its images.
router.post('/', async (req, res) => {
  const input = validate(createGallerySchema, req.body ?? {});

  const website = await prisma.website.findFirst({
    where: { id: input.websiteId, ...ownedWebsiteWhere(req.user.id) },
    select: {
      id: true,
      mediaFolder: true,
      abilities: { where: { kind: 'galleries', removedAt: null }, select: { id: true } },
    },
  });
  if (!website) throw new ServerError(404, WEBSITE_NOT_FOUND);
  if (website.abilities.length === 0) throw new ServerError(403, ADD_GALLERIES_FIRST);

  assertImagesInFolder(input.images, website.mediaFolder);

  // Two creates on one website at the same moment clash, whatever their names.
  const gallery = await createGalleryRetrying(req, website, input);

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
// image list. websiteId, status and slug can't be changed here; publishAt is left as it is when it
// isn't sent.
router.patch('/:id', async (req, res) => {
  const input = validate(updateGallerySchema, req.body ?? {});

  const gallery = await findOwnedGallery(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
    status: true,
    publishAt: true,
    website: { select: { mediaFolder: true } },
    images: { select: { id: true } },
  });
  if (!gallery) throw new ServerError(404, GALLERY_NOT_FOUND);

  assertPublishAtAllowed(input.publishAt, gallery);
  assertOwnImages(input.images, gallery.images);
  assertImagesInFolder(input.images, gallery.website.mediaFolder);
  const keptImageIds = input.images.filter((image) => image.id).map((image) => image.id);

  // Stored images missing from the list are deleted, then writeImages updates the kept ones in
  // their new order and inserts the new ones. If any part fails, nothing is changed.
  const updated = await prisma.$transaction(async (tx) => {
    await assertNameAvailable(tx, gallery.websiteId, input.galleryName, gallery.id);
    await tx.gallery.update({
      where: { id: gallery.id },
      data: {
        galleryName: input.galleryName,
        title: input.title,
        copy: input.copy,
        publishAt: input.publishAt,
      },
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
// hidden from the client website; the site owner still sees it. Publishing by hand clears a go-live
// time.
router.patch('/:id/status', async (req, res) => {
  const { status } = validate(galleryStatusSchema, req.body ?? {});

  const gallery = await findOwnedGallery(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
    status: true,
  });
  if (!gallery) throw new ServerError(404, GALLERY_NOT_FOUND);

  const action =
    status === 'published' ? AUDIT_ACTIONS.GALLERY_PUBLISHED : AUDIT_ACTIONS.GALLERY_DRAFTED;
  const updated = await prisma.$transaction(async (tx) => {
    await recordGalleryEvent(tx, req, action, gallery);
    return tx.gallery.update({
      where: { id: gallery.id },
      data: toStatusData(status, gallery.status),
      select: GALLERY_SELECT,
    });
  });

  res.json({ data: toGallery(updated) });
  revalidate(gallery.websiteId, { galleryId: gallery.id });
});

// PATCH /api/siteOwner/galleries/:id/publishAt — set or clear a draft's go-live date from the
// gallery's page, without the full edit form. Only a draft has one, so there is no revalidation.
router.patch('/:id/publishAt', async (req, res) => {
  const input = validate(publishAtSchema, req.body ?? {});

  const gallery = await findOwnedGallery(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
    status: true,
    publishAt: true,
  });
  if (!gallery) throw new ServerError(404, GALLERY_NOT_FOUND);

  assertPublishAtAllowed(input.publishAt, gallery);

  const updated = await prisma.$transaction(async (tx) => {
    await recordGalleryEvent(tx, req, AUDIT_ACTIONS.GALLERY_UPDATED, gallery);
    return tx.gallery.update({
      where: { id: gallery.id },
      data: { publishAt: input.publishAt },
      select: GALLERY_SELECT,
    });
  });

  res.json({ data: toGallery(updated) });
});

// Saves a gallery's request note and puts its placement to requested (from none or live), so the
// admin's pill flags the gallery to place or move.
function saveRequest(req, gallery, requestNote, action) {
  return prisma.$transaction(async (tx) => {
    await recordGalleryEvent(tx, req, action, gallery);
    return tx.gallery.update({
      where: { id: gallery.id },
      data: { requestNote, requestedAt: new Date(), placement: 'requested' },
      select: GALLERY_SELECT,
    });
  });
}

// POST /api/siteOwner/galleries/:id/request — the gallery's request message: where on the client
// website it should go. Sent once, after the gallery is created.
router.post('/:id/request', async (req, res) => {
  const input = validate(requestGallerySchema, req.body ?? {});

  const gallery = await findOwnedGallery(req.user.id, req.params.id, REQUEST_CHECK_SELECT);
  if (!gallery) throw new ServerError(404, GALLERY_NOT_FOUND);
  if (gallery.requestedAt) throw new ServerError(409, ALREADY_REQUESTED);

  const updated = await saveRequest(
    req,
    gallery,
    input.requestNote,
    AUDIT_ACTIONS.GALLERY_REQUESTED,
  );

  res.json({ data: toGallery(updated) });
  sendRequestEmail(gallery.websiteId, { siteOwnerId: req.user.id, galleryId: gallery.id });
});

// PATCH /api/siteOwner/galleries/:id/request — the site owner changed their mind about where the
// gallery should go, live or not (Rich, 2026-11-02). Replaces the note, and the gallery goes back
// to requested until the admin moves it and sets it live again.
router.patch('/:id/request', async (req, res) => {
  const input = validate(requestGallerySchema, req.body ?? {});

  const gallery = await findOwnedGallery(req.user.id, req.params.id, REQUEST_CHECK_SELECT);
  if (!gallery) throw new ServerError(404, GALLERY_NOT_FOUND);
  if (!gallery.requestedAt) throw new ServerError(409, NOT_REQUESTED);

  const updated = await saveRequest(
    req,
    gallery,
    input.requestNote,
    AUDIT_ACTIONS.GALLERY_REQUEST_UPDATED,
  );

  res.json({ data: toGallery(updated) });
  sendRequestEmail(gallery.websiteId, {
    siteOwnerId: req.user.id,
    galleryId: gallery.id,
    isUpdate: true,
  });
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
    await tx.gallery.update({
      where: { id: gallery.id },
      data: { deletedAt: new Date(), publishAt: null },
    });
  });

  res.status(204).end();
  revalidate(gallery.websiteId, { galleryId: gallery.id });
});

module.exports = router;
