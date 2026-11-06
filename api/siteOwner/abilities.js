// Site owner ability routes, mounted at /api/siteOwner/abilities: add an ability to a website,
// send or edit its request form, turn it on or off, and remove it.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const { validate } = require('../../validation/validate');
const {
  addAbilitySchema,
  requestAbilitySchema,
  turnedOnSchema,
} = require('../../validation/ability');
const { ownedWebsiteWhere } = require('../../lib/ownership');
const { DELETED_GRACE_MS } = require('../../lib/retention');
const {
  ABILITY_SELECT,
  findOwnedAbility,
  toAbility,
  recordAbilityEvent,
} = require('../../lib/abilities');
const { AUDIT_ACTIONS, recordAuditEvent } = require('../../lib/audit');
const revalidate = require('../../services/revalidate');
const sendRequestEmail = require('../../services/requestEmail');

const router = express.Router();

const ABILITY_NOT_FOUND = 'Ability not found.';
const WEBSITE_NOT_FOUND = 'Website not found.';
const ALREADY_ADDED = 'This ability has already been added.';
const ALREADY_REQUESTED = 'This ability has already been requested.';
const NOT_LIVE = 'This ability can be turned on or off once it is live.';
const POSTS_STAY = "Posts can't be removed.";
const GALLERIES_PER_GALLERY = 'Photo Galleries are requested one gallery at a time.';
const NOT_REQUESTED = "This ability hasn't been requested yet.";

// One gallery event per gallery that removing or restoring the ability deleted or brought back.
async function recordGalleryEvents(tx, req, action, galleries) {
  for (const gallery of galleries) {
    await recordAuditEvent(tx, req, {
      action,
      actorId: req.user.id,
      actorEmail: req.user.email,
      targetType: 'gallery',
      targetId: gallery.id,
      metadata: { websiteId: gallery.websiteId },
    });
  }
}

// A first add, or an add more than 30 days after a removal, once the galleries it deleted are
// gone for good. The ability keeps its status and switch: removing it never unwired its code, and
// each new gallery is requested on its own.
async function addAbility(tx, req, websiteId, kind, removed) {
  const ability = removed
    ? await tx.websiteAbility.update({
        where: { id: removed.id },
        data: { removedAt: null },
        select: ABILITY_SELECT,
      })
    : await tx.websiteAbility.create({ data: { websiteId, kind }, select: ABILITY_SELECT });
  await recordAbilityEvent(tx, req, AUDIT_ACTIONS.ABILITY_ADDED, ability);
  return ability;
}

// An add within 30 days of a removal: the galleries the removal deleted (stamped with its exact
// time, so galleries deleted one by one before it stay deleted) come back, and the ability keeps
// the status and switch it had.
async function restoreAbility(tx, req, removed) {
  const galleries = await tx.gallery.findMany({
    where: { websiteId: removed.websiteId, deletedAt: removed.removedAt },
    select: { id: true, websiteId: true },
  });
  await tx.gallery.updateMany({
    where: { id: { in: galleries.map((gallery) => gallery.id) } },
    data: { deletedAt: null },
  });
  await recordGalleryEvents(tx, req, AUDIT_ACTIONS.GALLERY_RESTORED, galleries);
  const ability = await tx.websiteAbility.update({
    where: { id: removed.id },
    data: { removedAt: null },
    select: ABILITY_SELECT,
  });
  await recordAbilityEvent(tx, req, AUDIT_ACTIONS.ABILITY_RESTORED, ability);
  return ability;
}

// POST /api/siteOwner/abilities — add an ability to one of the site owner's websites.
router.post('/', async (req, res) => {
  const input = validate(addAbilitySchema, req.body ?? {});

  const website = await prisma.website.findFirst({
    where: { id: input.websiteId, ...ownedWebsiteWhere(req.user.id) },
    select: { id: true },
  });
  if (!website) throw new ServerError(404, WEBSITE_NOT_FOUND);

  // One row per website and kind: a removed ability is the same row, added back.
  const existing = await prisma.websiteAbility.findUnique({
    where: { websiteId_kind: { websiteId: website.id, kind: input.kind } },
    select: ABILITY_SELECT,
  });
  if (existing && existing.removedAt === null) throw new ServerError(409, ALREADY_ADDED);

  const canRestore =
    existing !== null && existing.removedAt.getTime() > Date.now() - DELETED_GRACE_MS;

  let ability;
  try {
    ability = await prisma.$transaction((tx) =>
      canRestore
        ? restoreAbility(tx, req, existing)
        : addAbility(tx, req, website.id, input.kind, existing),
    );
  } catch (err) {
    // Safety net: a concurrent add created the row after the check above.
    if (err.code === 'P2002') throw new ServerError(409, ALREADY_ADDED);
    throw err;
  }

  res.status(201).json({ data: toAbility(ability) });
  // Restored galleries return to the client website. A plain add shows nothing new there.
  if (canRestore) revalidate(website.id, { ability: ability.kind });
});

// Saves the posts request note and puts their placement to requested, for the admin to place (or
// move) posts on the client website. The ability's status is left as it is.
function saveRequest(req, ability, requestNote, action) {
  return prisma.$transaction(async (tx) => {
    const requested = await tx.websiteAbility.update({
      where: { id: ability.id },
      data: { placement: 'requested', requestNote, requestedAt: new Date() },
      select: ABILITY_SELECT,
    });
    await recordAbilityEvent(tx, req, action, requested);
    return requested;
  });
}

// POST /api/siteOwner/abilities/:id/request — the posts request form: where on the client website
// posts should appear. Sent once, after the first post; deleting every post never asks for it
// again, and the site owner changes it with the PATCH below. Moves posts' placement to requested
// for the admin to place them. Photo Galleries are requested per gallery instead (./galleries.js).
router.post('/:id/request', async (req, res) => {
  const input = validate(requestAbilitySchema, req.body ?? {});

  const ability = await findOwnedAbility(req.user.id, req.params.id);
  if (!ability) throw new ServerError(404, ABILITY_NOT_FOUND);
  if (ability.kind === 'galleries') throw new ServerError(409, GALLERIES_PER_GALLERY);
  if (ability.placement !== null) throw new ServerError(409, ALREADY_REQUESTED);

  const updated = await saveRequest(
    req,
    ability,
    input.requestNote,
    AUDIT_ACTIONS.ABILITY_REQUESTED,
  );

  res.json({ data: toAbility(updated) });
  sendRequestEmail(ability.websiteId, { siteOwnerId: req.user.id, abilityId: ability.id });
});

// PATCH /api/siteOwner/abilities/:id/request — the site owner changed their mind about where posts
// should go, live or not. Replaces the note and puts posts' placement back to
// requested, so the admin's pill marks it until the component is moved and posts are set live.
router.patch('/:id/request', async (req, res) => {
  const input = validate(requestAbilitySchema, req.body ?? {});

  const ability = await findOwnedAbility(req.user.id, req.params.id);
  if (!ability) throw new ServerError(404, ABILITY_NOT_FOUND);
  if (ability.kind === 'galleries') throw new ServerError(409, GALLERIES_PER_GALLERY);
  if (!ability.requestedAt) throw new ServerError(409, NOT_REQUESTED);

  const updated = await saveRequest(
    req,
    ability,
    input.requestNote,
    AUDIT_ACTIONS.ABILITY_REQUEST_UPDATED,
  );

  res.json({ data: toAbility(updated) });
  sendRequestEmail(ability.websiteId, {
    siteOwnerId: req.user.id,
    abilityId: ability.id,
    isUpdate: true,
  });
});

// PATCH /api/siteOwner/abilities/:id/turnedOn — the site owner's On / Off switch, once the ability
// is live. Off hides its content from the public API; the site owner can still edit it.
router.patch('/:id/turnedOn', async (req, res) => {
  const { turnedOn } = validate(turnedOnSchema, req.body ?? {});

  const ability = await findOwnedAbility(req.user.id, req.params.id);
  if (!ability) throw new ServerError(404, ABILITY_NOT_FOUND);
  if (ability.status !== 'live') throw new ServerError(409, NOT_LIVE);
  // Already as asked: nothing changes, so no event and no revalidation.
  if (ability.turnedOn === turnedOn) return res.json({ data: toAbility(ability) });

  const action = turnedOn ? AUDIT_ACTIONS.ABILITY_TURNED_ON : AUDIT_ACTIONS.ABILITY_TURNED_OFF;
  const updated = await prisma.$transaction(async (tx) => {
    const switched = await tx.websiteAbility.update({
      where: { id: ability.id },
      data: { turnedOn },
      select: ABILITY_SELECT,
    });
    await recordAbilityEvent(tx, req, action, switched);
    return switched;
  });

  res.json({ data: toAbility(updated) });
  revalidate(ability.websiteId, { ability: ability.kind });
});

// DELETE /api/siteOwner/abilities/:id — remove Photo Galleries from the website. Its galleries are
// deleted with the same time stamped on the ability, so adding it back within 30 days can restore
// exactly those; after that the upload cleanup deletes their images (services/sweepUploads.js).
// Their go-live dates are cleared, so a gallery that comes back with the ability never publishes
// by surprise.
router.delete('/:id', async (req, res) => {
  const ability = await findOwnedAbility(req.user.id, req.params.id);
  if (!ability) throw new ServerError(404, ABILITY_NOT_FOUND);
  if (ability.kind === 'posts') throw new ServerError(409, POSTS_STAY);

  const removedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const galleries = await tx.gallery.findMany({
      where: { websiteId: ability.websiteId, deletedAt: null },
      select: { id: true, websiteId: true },
    });
    await tx.gallery.updateMany({
      where: { id: { in: galleries.map((gallery) => gallery.id) } },
      data: { deletedAt: removedAt, publishAt: null },
    });
    await recordGalleryEvents(tx, req, AUDIT_ACTIONS.GALLERY_DELETED, galleries);
    const removed = await tx.websiteAbility.update({
      where: { id: ability.id },
      data: { removedAt },
      select: ABILITY_SELECT,
    });
    await recordAbilityEvent(tx, req, AUDIT_ACTIONS.ABILITY_REMOVED, removed);
  });

  res.status(204).end();
  revalidate(ability.websiteId, { ability: ability.kind });
});

module.exports = router;
