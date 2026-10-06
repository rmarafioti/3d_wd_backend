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
const revalidate = require('../../services/revalidate');

const router = express.Router();
router.use(requireAuth, requireRole('site_owner'));

const POST_NOT_FOUND = 'Post not found.';

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

// Images and links are ordered by id: UUIDv7 is time-ordered, so this is the order they were added.
const POST_SELECT = {
  id: true,
  websiteId: true,
  postName: true,
  header: true,
  subHeader: true,
  body: true,
  postDate: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  website: { select: { websiteName: true } },
  images: {
    orderBy: { id: 'asc' },
    select: { id: true, src: true, width: true, height: true, altText: true },
  },
  links: { orderBy: { id: 'asc' }, select: { id: true, name: true, url: true } },
};

// Prisma row (selected with POST_SELECT) → the contract's Post shape.
function toPost(post) {
  return {
    id: post.id,
    websiteId: post.websiteId,
    websiteName: post.website.websiteName,
    postName: post.postName,
    header: post.header,
    subHeader: post.subHeader,
    body: post.body,
    postDate: toDateOnly(post.postDate),
    active: post.active,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    images: post.images,
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

// Three-way reconcile of a post's images or links inside a transaction: stored items missing from
// the list are deleted, items with an id are updated, items without one are inserted (in order).
async function reconcileItems(model, postId, items) {
  const keptIds = items.filter((item) => item.id).map((item) => item.id);
  await model.deleteMany({ where: { postId, id: { notIn: keptIds } } });

  for (const { id, ...data } of items.filter((item) => item.id)) {
    await model.update({ where: { id }, data });
  }

  const added = items.filter((item) => !item.id).map(({ id, ...data }) => ({ ...data, postId }));
  if (added.length) await model.createMany({ data: added });
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

// POST /api/siteOwner/posts — create a post with its images and links.
router.post('/posts', async (req, res) => {
  const input = validate(createPostSchema, req.body ?? {});

  const website = await prisma.website.findFirst({
    where: { id: input.websiteId, ...ownedWebsiteWhere(req.user.id) },
    select: { id: true },
  });
  if (!website) throw new ServerError(404, 'Website not found.');

  // Post, then images, then links: if any insert fails the whole create rolls back.
  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: {
        websiteId: website.id,
        postName: input.postName,
        header: input.header,
        subHeader: input.subHeader,
        body: input.body,
        postDate: fromDateOnly(input.postDate),
        active: input.active,
      },
      select: { id: true },
    });
    if (input.images.length) {
      await tx.image.createMany({
        data: input.images.map((image) => ({ ...image, postId: created.id })),
      });
    }
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

// GET /api/siteOwner/posts/:id — one post with its images and links.
router.get('/posts/:id', async (req, res) => {
  const post = await findOwnedPost(req.user.id, req.params.id, POST_SELECT);
  if (!post) throw new ServerError(404, POST_NOT_FOUND);
  res.json({ data: toPost(post) });
});

// PATCH /api/siteOwner/posts/:id — full edit form: the post's fields plus the complete image and
// link lists. websiteId and active can't be changed here.
router.patch('/posts/:id', async (req, res) => {
  const input = validate(updatePostSchema, req.body ?? {});

  const post = await findOwnedPost(req.user.id, req.params.id, {
    id: true,
    websiteId: true,
    images: { select: { id: true } },
    links: { select: { id: true } },
  });
  if (!post) throw new ServerError(404, POST_NOT_FOUND);

  assertOwnItems(input.images, post.images);
  assertOwnItems(input.links, post.links);

  // If any part fails, nothing is changed.
  const updated = await prisma.$transaction(async (tx) => {
    await tx.post.update({
      where: { id: post.id },
      data: {
        postName: input.postName,
        header: input.header,
        subHeader: input.subHeader,
        body: input.body,
        postDate: fromDateOnly(input.postDate),
      },
    });
    await reconcileItems(tx.image, post.id, input.images);
    await reconcileItems(tx.link, post.id, input.links);
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
