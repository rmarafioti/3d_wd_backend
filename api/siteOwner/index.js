// Site owner routes, mounted at /api/siteOwner: websites, post create / read / edit / status /
// publish date / delete / restore and upload signing, with the gallery and ability routers.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const requireAuth = require('../../middleware/requireAuth');
const requireRole = require('../../middleware/requireRole');
const { validate } = require('../../validation/validate');
const {
  createPostSchema,
  updatePostSchema,
  postStatusSchema,
  listDeletedPostsSchema,
} = require('../../validation/post');
const { publishAtSchema, assertPublishAtAllowed } = require('../../validation/fields');
const { signUploadSchema } = require('../../validation/upload');
const { toDateOnly, fromDateOnly } = require('../../lib/dates');
const { toBody } = require('../../lib/postBody');
const { signUpload } = require('../../lib/cloudinary');
const { ownedWebsiteWhere, assertOwnImages, assertImagesInFolder } = require('../../lib/ownership');
const { AUDIT_ACTIONS, recordAuditEvent } = require('../../lib/audit');
const { ABILITY_SELECT, toAbility } = require('../../lib/abilities');
const { uploadSignRateLimit } = require('../../lib/rateLimit');
const { DELETED_GRACE_MS } = require('../../lib/retention');
const { toStatusData } = require('../../lib/status');
const revalidate = require('../../services/revalidate');
const galleries = require('./galleries');
const abilities = require('./abilities');
const notifications = require('./notifications');
const threads = require('./threads');

const router = express.Router();
router.use(requireAuth, requireRole('site_owner'));
router.use('/galleries', galleries);
router.use('/abilities', abilities);
router.use('/notifications', notifications);
router.use('/threads', threads);

const POST_NOT_FOUND = 'Post not found.';
const WEBSITE_NOT_FOUND = 'Website not found.';

// Body elements are ordered by position.
const POST_SELECT = {
  id: true,
  websiteId: true,
  postName: true,
  header: true,
  subHeader: true,
  postDate: true,
  status: true,
  publishAt: true,
  publishedAt: true,
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

function findOwnedPost(accountId, postId, select) {
  return prisma.post.findFirst({
    where: { id: postId, deletedAt: null, website: ownedWebsiteWhere(accountId) },
    select,
  });
}

// A deleted post stays restorable while the upload cleanup still keeps its images: deleted less
// than DELETED_GRACE_MS ago, the same cutoff services/sweepUploads.js uses. The cutoff only moves
// forward, so a post this accepts has never had its images swept.
function restorableWhere(accountId) {
  return {
    deletedAt: { gt: new Date(Date.now() - DELETED_GRACE_MS) },
    website: ownedWebsiteWhere(accountId),
  };
}

function findRestorablePost(accountId, postId, select) {
  return prisma.post.findFirst({ where: { id: postId, ...restorableWhere(accountId) }, select });
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
    status: post.status,
    publishAt: post.publishAt,
    publishedAt: post.publishedAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    body: toBody(post.elements),
  };
}

// Prisma row → the contract's DeletedPostSummary, with the last moment it can be restored.
function toDeletedPostSummary({ website, postDate, deletedAt, ...post }) {
  return {
    ...post,
    websiteName: website.websiteName,
    postDate: toDateOnly(postDate),
    deletedAt,
    restorableUntil: new Date(deletedAt.getTime() + DELETED_GRACE_MS),
  };
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

// GET /api/siteOwner/websites — the site owner's active websites, each with its abilities (not
// removed, in the order they were added) and post and gallery summaries.
router.get('/websites', async (req, res) => {
  const websites = await prisma.website.findMany({
    where: ownedWebsiteWhere(req.user.id),
    orderBy: { websiteName: 'asc' },
    select: {
      id: true,
      websiteName: true,
      url: true,
      active: true,
      abilities: {
        where: { removedAt: null },
        orderBy: { createdAt: 'asc' },
        select: ABILITY_SELECT,
      },
      posts: {
        where: { deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          postName: true,
          postDate: true,
          status: true,
          publishAt: true,
          publishedAt: true,
          createdAt: true,
        },
      },
      galleries: {
        where: { deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          galleryName: true,
          slug: true,
          status: true,
          placement: true,
          requestedAt: true,
          publishAt: true,
          publishedAt: true,
          createdAt: true,
        },
      },
    },
  });

  const data = websites.map((website) => ({
    ...website,
    abilities: website.abilities.map(toAbility),
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
        status: input.status,
        publishAt: input.publishAt ?? null,
        publishedAt: input.status === 'published' ? new Date() : null,
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
  revalidate(website.id, { postId: post.id });
});

// GET /api/siteOwner/posts/deleted — the account's posts deleted in the last 30 days, newest
// deletion first, a page at a time (limit, cursor). Registered before /posts/:id so "deleted" is
// never read as an id.
router.get('/posts/deleted', async (req, res) => {
  const input = validate(listDeletedPostsSchema, req.query);

  // Sorted by deletion time, not id, so Prisma's own cursor pages from the cursor post's place in
  // that order. One row more than the page is read to tell whether another page follows.
  const posts = await prisma.post.findMany({
    where: restorableWhere(req.user.id),
    orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
    ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
    take: input.limit + 1,
    select: {
      id: true,
      websiteId: true,
      postName: true,
      postDate: true,
      status: true,
      deletedAt: true,
      website: { select: { websiteName: true } },
    },
  });

  const hasNextPage = posts.length > input.limit;
  const data = (hasNextPage ? posts.slice(0, input.limit) : posts).map(toDeletedPostSummary);
  res.json({ data, nextCursor: hasNextPage ? data.at(-1).id : null });
});

// GET /api/siteOwner/posts/:id — one post with its body.
router.get('/posts/:id', async (req, res) => {
  const post = await findOwnedPost(req.user.id, req.params.id, POST_SELECT);
  if (!post) throw new ServerError(404, POST_NOT_FOUND);
  res.json({ data: toPost(post) });
});

// PATCH /api/siteOwner/posts/:id — full edit form: the post's fields plus the complete body.
// websiteId and status can't be changed here; publishAt is left as it is when it isn't sent.
router.patch('/posts/:id', async (req, res) => {
  const input = validate(updatePostSchema, req.body ?? {});

  const post = await findOwnedPost(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
    status: true,
    publishAt: true,
    website: { select: { mediaFolder: true } },
    images: { select: { id: true } },
  });
  if (!post) throw new ServerError(404, POST_NOT_FOUND);

  assertPublishAtAllowed(input.publishAt, post);

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
        publishAt: input.publishAt,
      },
    });
    await tx.element.deleteMany({ where: { postId: post.id } });
    await tx.image.deleteMany({ where: { postId: post.id, id: { notIn: keptImageIds } } });
    await writeBody(tx, post.id, input.body);
    await recordPostEvent(tx, req, AUDIT_ACTIONS.POST_UPDATED, post);
    return tx.post.findUnique({ where: { id: post.id }, select: POST_SELECT });
  });

  res.json({ data: toPost(updated) });
  revalidate(post.websiteId, { postId: post.id });
});

// PATCH /api/siteOwner/posts/:id/status — set a post to draft or published. A draft is hidden from
// the client website; the site owner still sees it. Publishing by hand clears a go-live date.
router.patch('/posts/:id/status', async (req, res) => {
  const { status } = validate(postStatusSchema, req.body ?? {});

  const post = await findOwnedPost(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
    status: true,
  });
  if (!post) throw new ServerError(404, POST_NOT_FOUND);

  const action = status === 'published' ? AUDIT_ACTIONS.POST_PUBLISHED : AUDIT_ACTIONS.POST_DRAFTED;
  const updated = await prisma.$transaction(async (tx) => {
    await recordPostEvent(tx, req, action, post);
    return tx.post.update({
      where: { id: post.id },
      data: toStatusData(status, post.status),
      select: POST_SELECT,
    });
  });

  res.json({ data: toPost(updated) });
  revalidate(post.websiteId, { postId: post.id });
});

// PATCH /api/siteOwner/posts/:id/publishAt — set or clear a draft's go-live date from the post's
// page, without the full edit form. Only a draft has one, so the client website shows nothing new
// and there is no revalidation.
router.patch('/posts/:id/publishAt', async (req, res) => {
  const input = validate(publishAtSchema, req.body ?? {});

  const post = await findOwnedPost(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
    status: true,
    publishAt: true,
  });
  if (!post) throw new ServerError(404, POST_NOT_FOUND);

  assertPublishAtAllowed(input.publishAt, post);

  const updated = await prisma.$transaction(async (tx) => {
    await recordPostEvent(tx, req, AUDIT_ACTIONS.POST_UPDATED, post);
    return tx.post.update({
      where: { id: post.id },
      data: { publishAt: input.publishAt },
      select: POST_SELECT,
    });
  });

  res.json({ data: toPost(updated) });
});

// DELETE /api/siteOwner/posts/:id — soft delete: stamps deletedAt, so the post is gone from the
// site owner's view and the client website but stays in the database. It can be restored for 30
// days; then the upload cleanup deletes its images (services/sweepUploads.js).
router.delete('/posts/:id', async (req, res) => {
  const post = await findOwnedPost(req.user.id, req.params.id, { id: true, websiteId: true });
  if (!post) throw new ServerError(404, POST_NOT_FOUND);

  await prisma.$transaction(async (tx) => {
    await recordPostEvent(tx, req, AUDIT_ACTIONS.POST_DELETED, post);
    // A deleted post never publishes on schedule, and a restored one comes back unscheduled.
    await tx.post.update({
      where: { id: post.id },
      data: { deletedAt: new Date(), publishAt: null },
    });
  });

  res.status(204).end();
  revalidate(post.websiteId, { postId: post.id });
});

// POST /api/siteOwner/posts/:id/restore — bring back a post deleted in the last 30 days, with its
// body, images and status. Posts placement is left as it is.
router.post('/posts/:id/restore', async (req, res) => {
  const post = await findRestorablePost(req.user.id, req.params.id, { id: true, websiteId: true });
  if (!post) throw new ServerError(404, POST_NOT_FOUND);

  const restored = await prisma.$transaction(async (tx) => {
    await recordPostEvent(tx, req, AUDIT_ACTIONS.POST_RESTORED, post);
    return tx.post.update({
      where: { id: post.id },
      data: { deletedAt: null },
      select: POST_SELECT,
    });
  });

  res.json({ data: toPost(restored) });
  revalidate(post.websiteId, { postId: post.id });
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
