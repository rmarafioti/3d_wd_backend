// Site owner routes, mounted at /api/siteOwner: the site owner's websites with post summaries,
// post create / read / edit / archive / make active, and the signature for uploading a website's
// images to Cloudinary. Every route requires a signed-in site owner. Every post change writes its
// audit event (lib/audit.js) inside the same transaction.
//
// Ownership: the account always comes from req.user (the session), never from the request.
// A website belongs to the site owner when an account_website row links them AND the website is
// active; a post belongs to them when its website does. Anything else is a 404, identical to
// "doesn't exist", so ids can't be probed.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const requireAuth = require('../../middleware/requireAuth');
const requireRole = require('../../middleware/requireRole');
const { validate } = require('../../validation/validate');
const { createPostSchema, updatePostSchema, postStatusSchema } = require('../../validation/post');
const { signUploadSchema } = require('../../validation/upload');
const { toDateOnly, fromDateOnly } = require('../../lib/dates');
const { toBody } = require('../../lib/postBody');
const { signUpload, isInFolder } = require('../../lib/cloudinary');
const { AUDIT_ACTIONS, recordAuditEvent } = require('../../lib/audit');
const { uploadSignRateLimit } = require('../../lib/rateLimit');
const revalidate = require('../../services/revalidate');

const router = express.Router();
router.use(requireAuth, requireRole('site_owner'));

const POST_NOT_FOUND = 'Post not found.';
const WEBSITE_NOT_FOUND = 'Website not found.';
const INVALID_IMAGE = 'Invalid image.';

// Body elements are ordered by position.
const POST_SELECT = {
  id: true,
  websiteId: true,
  postName: true,
  header: true,
  subHeader: true,
  postDate: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  website: { select: { websiteName: true } },
  elements: {
    orderBy: { position: 'asc' },
    select: {
      type: true,
      text: true,
      image: { select: { id: true, src: true, width: true, height: true, altText: true } },
    },
  },
};

// The Prisma `where` for "an active website linked to this account".
function ownedWebsiteWhere(accountId) {
  return { active: true, accountWebsites: { some: { accountId } } };
}

function findOwnedPost(accountId, postId, select) {
  return prisma.post.findFirst({
    where: { id: postId, website: ownedWebsiteWhere(accountId) },
    select,
  });
}

// Prisma row (selected with POST_SELECT) → the contract's Post shape.
function toPost(post) {
  return {
    id: post.id,
    websiteId: post.websiteId,
    websiteName: post.website.websiteName,
    postName: post.postName,
    header: post.header,
    subHeader: post.subHeader,
    postDate: toDateOnly(post.postDate),
    active: post.active,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    body: toBody(post.elements),
  };
}

// Every image id sent on an edit must already belong to this post, and appear only once.
// Stops a site owner editing another post's images by guessing ids.
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
// Stops a post showing an image from anywhere else, including another website's folder.
function assertImagesInFolder(images, mediaFolder) {
  if (images.some((image) => !isInFolder(image.src, mediaFolder))) {
    throw new ServerError(400, INVALID_IMAGE);
  }
}

// The images in a validated body, in body order.
function bodyImages(body) {
  return body.filter((item) => item.type === 'image').map((item) => item.image);
}

// Writes a post's body inside a transaction, in list order: each image element's image is updated
// (when it carries an id) or inserted, then every element is inserted with its list position.
// Images are created one at a time because createMany doesn't return the new ids.
async function writeBody(tx, postId, body) {
  const elements = [];
  for (const [position, element] of body.entries()) {
    if (element.type === 'paragraph') {
      elements.push({ postId, position, type: 'paragraph', text: element.text });
      continue;
    }
    const { id, ...image } = element.image;
    const saved = id
      ? await tx.image.update({ where: { id }, data: image, select: { id: true } })
      : await tx.image.create({ data: { ...image, postId }, select: { id: true } });
    elements.push({ postId, position, type: 'image', imageId: saved.id });
  }
  await tx.element.createMany({ data: elements });
}

// A post change's audit event, written with the transaction client that made the change.
function recordPostEvent(tx, req, action, post) {
  return recordAuditEvent(tx, req, {
    action,
    actorId: req.user.id,
    actorEmail: req.user.email,
    targetType: 'post',
    targetId: post.id,
    metadata: { websiteId: post.websiteId },
  });
}

// GET /api/siteOwner/websites — the site owner's active websites, each with post summaries.
router.get('/websites', async (req, res) => {
  const websites = await prisma.website.findMany({
    where: ownedWebsiteWhere(req.user.id),
    orderBy: { websiteName: 'asc' },
    select: {
      id: true,
      websiteName: true,
      url: true,
      active: true,
      posts: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, postName: true, postDate: true, active: true, createdAt: true },
      },
    },
  });

  const data = websites.map((website) => ({
    ...website,
    posts: website.posts.map((post) => ({ ...post, postDate: toDateOnly(post.postDate) })),
  }));
  res.json({ data });
});

// POST /api/siteOwner/posts — create a post with its body (paragraphs and images).
router.post('/posts', async (req, res) => {
  const input = validate(createPostSchema, req.body ?? {});

  const website = await prisma.website.findFirst({
    where: { id: input.websiteId, ...ownedWebsiteWhere(req.user.id) },
    select: { id: true, mediaFolder: true },
  });
  if (!website) throw new ServerError(404, WEBSITE_NOT_FOUND);

  assertImagesInFolder(bodyImages(input.body), website.mediaFolder);

  // Post, then body: if any insert fails the whole create rolls back.
  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: {
        websiteId: website.id,
        postName: input.postName,
        header: input.header,
        subHeader: input.subHeader,
        postDate: fromDateOnly(input.postDate),
        active: input.active,
      },
      select: { id: true },
    });
    await writeBody(tx, created.id, input.body);
    await recordPostEvent(tx, req, AUDIT_ACTIONS.POST_CREATED, {
      id: created.id,
      websiteId: website.id,
    });
    return tx.post.findUnique({ where: { id: created.id }, select: POST_SELECT });
  });

  res.status(201).json({ data: toPost(post) });
  // After commit and after responding; never awaited, never throws (services/revalidate.js).
  revalidate(website.id, post.id);
});

// GET /api/siteOwner/posts/:id — one post with its body.
router.get('/posts/:id', async (req, res) => {
  const post = await findOwnedPost(req.user.id, req.params.id, POST_SELECT);
  if (!post) throw new ServerError(404, POST_NOT_FOUND);
  res.json({ data: toPost(post) });
});

// PATCH /api/siteOwner/posts/:id — full edit form: the post's fields plus the complete body.
// websiteId and active can't be changed here.
router.patch('/posts/:id', async (req, res) => {
  const input = validate(updatePostSchema, req.body ?? {});

  const post = await findOwnedPost(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
    website: { select: { mediaFolder: true } },
    images: { select: { id: true } },
  });
  if (!post) throw new ServerError(404, POST_NOT_FOUND);

  const images = bodyImages(input.body);
  const keptImageIds = images.filter((image) => image.id).map((image) => image.id);
  assertOwnImages(images, post.images);
  assertImagesInFolder(images, post.website.mediaFolder);

  // The body is rewritten in its new order: elements are deleted first, so no element still points
  // at an image being removed, then stored images missing from the body are deleted, and
  // writeBody updates the kept images, inserts the new ones and re-inserts every element.
  // If any part fails, nothing is changed.
  const updated = await prisma.$transaction(async (tx) => {
    await tx.post.update({
      where: { id: post.id },
      data: {
        postName: input.postName,
        header: input.header,
        subHeader: input.subHeader,
        postDate: fromDateOnly(input.postDate),
      },
    });
    await tx.element.deleteMany({ where: { postId: post.id } });
    await tx.image.deleteMany({ where: { postId: post.id, id: { notIn: keptImageIds } } });
    await writeBody(tx, post.id, input.body);
    await recordPostEvent(tx, req, AUDIT_ACTIONS.POST_UPDATED, post);
    return tx.post.findUnique({ where: { id: post.id }, select: POST_SELECT });
  });

  res.json({ data: toPost(updated) });
  revalidate(post.websiteId, post.id);
});

// PATCH /api/siteOwner/posts/:id/status — archive ({ active: false }) or make active. This is the
// soft delete: posts are never removed from the database.
router.patch('/posts/:id/status', async (req, res) => {
  const { active } = validate(postStatusSchema, req.body ?? {});

  const post = await findOwnedPost(req.user.id, req.params.id, { id: true, websiteId: true });
  if (!post) throw new ServerError(404, POST_NOT_FOUND);

  const action = active ? AUDIT_ACTIONS.POST_ACTIVATED : AUDIT_ACTIONS.POST_ARCHIVED;
  const updated = await prisma.$transaction(async (tx) => {
    await recordPostEvent(tx, req, action, post);
    return tx.post.update({ where: { id: post.id }, data: { active }, select: POST_SELECT });
  });

  res.json({ data: toPost(updated) });
  revalidate(post.websiteId, post.id);
});

// POST /api/siteOwner/uploads/sign — one signed upload for the website's Cloudinary folder.
// The browser uploads the files straight to Cloudinary; nothing is written to the database.
// Rate limited per account (lib/rateLimit.js).
router.post('/uploads/sign', uploadSignRateLimit, async (req, res) => {
  const input = validate(signUploadSchema, req.body ?? {});

  const website = await prisma.website.findFirst({
    where: { id: input.websiteId, ...ownedWebsiteWhere(req.user.id) },
    select: { mediaFolder: true },
  });
  if (!website) throw new ServerError(404, WEBSITE_NOT_FOUND);

  res.json({ data: signUpload(website.mediaFolder) });
});

module.exports = router;
