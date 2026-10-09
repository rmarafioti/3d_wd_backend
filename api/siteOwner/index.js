// Site owner routes, mounted at /api/siteOwner: the site owner's websites with post summaries,
// and post create / read / edit / archive / make active. Every route requires a signed-in site owner.
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
const { toDateOnly, fromDateOnly } = require('../../lib/dates');
const { toBody } = require('../../lib/postBody');
const revalidate = require('../../services/revalidate');

const router = express.Router();
router.use(requireAuth, requireRole('site_owner'));

const POST_NOT_FOUND = 'Post not found.';

// Body elements are ordered by position. Links are ordered by id: UUIDv7 is time-ordered, so this
// is the order they were added.
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
  links: { orderBy: { id: 'asc' }, select: { id: true, name: true, url: true } },
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
    links: post.links,
  };
}

// Every image/link id sent on an edit must already belong to this post, and appear only once.
// Stops a site owner editing another post's items by guessing ids.
function assertOwnItems(items, storedItems) {
  const storedIds = new Set(storedItems.map((item) => item.id));
  const seen = new Set();
  for (const { id } of items) {
    if (id === undefined) continue;
    if (!storedIds.has(id) || seen.has(id)) {
      throw new ServerError(400, 'Invalid image or link.');
    }
    seen.add(id);
  }
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

// Three-way reconcile of a post's links inside a transaction: stored items missing from the
// list are deleted, items with an id are updated, items without one are inserted (in order).
async function reconcileLinks(tx, postId, links) {
  const keptIds = links.filter((link) => link.id).map((link) => link.id);
  await tx.link.deleteMany({ where: { postId, id: { notIn: keptIds } } });

  for (const { id, ...data } of links.filter((link) => link.id)) {
    await tx.link.update({ where: { id }, data });
  }

  const added = links.filter((link) => !link.id).map(({ id, ...data }) => ({ ...data, postId }));
  if (added.length) await tx.link.createMany({ data: added });
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

// POST /api/siteOwner/posts — create a post with its body (paragraphs and images) and links.
router.post('/posts', async (req, res) => {
  const input = validate(createPostSchema, req.body ?? {});

  const website = await prisma.website.findFirst({
    where: { id: input.websiteId, ...ownedWebsiteWhere(req.user.id) },
    select: { id: true },
  });
  if (!website) throw new ServerError(404, 'Website not found.');

  // Post, then body, then links: if any insert fails the whole create rolls back.
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
    if (input.links.length) {
      await tx.link.createMany({
        data: input.links.map((link) => ({ ...link, postId: created.id })),
      });
    }
    return tx.post.findUnique({ where: { id: created.id }, select: POST_SELECT });
  });

  res.status(201).json({ data: toPost(post) });
  // After commit and after responding; never awaited, never throws (services/revalidate.js).
  revalidate(website.id, post.id);
});

// GET /api/siteOwner/posts/:id — one post with its body and links.
router.get('/posts/:id', async (req, res) => {
  const post = await findOwnedPost(req.user.id, req.params.id, POST_SELECT);
  if (!post) throw new ServerError(404, POST_NOT_FOUND);
  res.json({ data: toPost(post) });
});

// PATCH /api/siteOwner/posts/:id — full edit form: the post's fields plus the complete body and
// link list. websiteId and active can't be changed here.
router.patch('/posts/:id', async (req, res) => {
  const input = validate(updatePostSchema, req.body ?? {});

  const post = await findOwnedPost(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
    images: { select: { id: true } },
    links: { select: { id: true } },
  });
  if (!post) throw new ServerError(404, POST_NOT_FOUND);

  const images = input.body.filter((item) => item.type === 'image').map((item) => item.image);
  const keptImageIds = images.filter((image) => image.id).map((image) => image.id);
  assertOwnItems(images, post.images);
  assertOwnItems(input.links, post.links);

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
    await reconcileLinks(tx, post.id, input.links);
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

  const updated = await prisma.post.update({
    where: { id: post.id },
    data: { active },
    select: POST_SELECT,
  });

  res.json({ data: toPost(updated) });
  revalidate(post.websiteId, post.id);
});

module.exports = router;
