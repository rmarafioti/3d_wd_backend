// Gallery and post slugs, each set once when its gallery or post is created, never changed, and
// unique within its website, deleted ones included (docs/setup.md → Gallery slugs, Post slugs).
const crypto = require('node:crypto');
const { ServerError } = require('../errors');

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 8;
// About where search results and link previews cut a URL's path short.
const POST_SLUG_MAX = 60;
const POST_SLUG_TAKEN = 'A post with this web address already exists.';

// randomInt draws each character uniformly, so no letter or digit is more likely than another.
function generateSlug() {
  let slug = '';
  for (let i = 0; i < SLUG_LENGTH; i += 1) {
    slug += SLUG_ALPHABET[crypto.randomInt(SLUG_ALPHABET.length)];
  }
  return slug;
}

// A generated code no other row of `model` (tx.gallery or tx.post) on this website has. A clash is
// about 1 in 2.8 trillion, so the loop almost always runs once.
async function drawFreeCode(model, websiteId) {
  for (;;) {
    const slug = generateSlug();
    const taken = await model.findFirst({ where: { websiteId, slug }, select: { id: true } });
    if (!taken) return slug;
  }
}

// The slug for a new gallery, inside the caller's transaction.
function findFreeGallerySlug(tx, websiteId) {
  return drawFreeCode(tx.gallery, websiteId);
}

// A post's header → its slug's base: accents removed, lowercased, every run of other characters
// one hyphen, at most 60 characters cut at a word boundary; null when no letter or digit is left.
// The add_post_slug migration's backfill repeats this rule in SQL, and its test checks they agree.
function toPostSlug(header) {
  const slug = (header ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return null;
  if (slug.length <= POST_SLUG_MAX) return slug;
  // Back to the last hyphen within one character past the cap, so no word is cut in half; a
  // single word longer than the cap has no hyphen to go back to and is cut at it.
  return slug
    .slice(0, POST_SLUG_MAX + 1)
    .replace(/-[^-]*$/, '')
    .slice(0, POST_SLUG_MAX);
}

// The slug for a new post, inside the caller's transaction: its header's base, or the first of
// base-2, base-3… that no other post on this website has. A post with no usable header gets a
// generated code like a gallery's. Two creates at once can pick the same one: the
// (website_id, slug) unique index fails the second, which the caller retries (lib/retry.js).
async function findFreePostSlug(tx, websiteId, header) {
  const base = toPostSlug(header);
  if (!base) return drawFreeCode(tx.post, websiteId);

  const taken = await tx.post.findMany({
    where: { websiteId, slug: { startsWith: base } },
    select: { slug: true },
  });
  const takenSlugs = new Set(taken.map((post) => post.slug));

  let slug = base;
  for (let n = 2; takenSlugs.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

// Throws the 409 when a post on the website, deleted ones included, already has the web address
// the site owner entered: it is refused, not given -2, since they chose it.
async function assertSlugAvailable(tx, websiteId, slug) {
  const taken = await tx.post.findFirst({ where: { websiteId, slug }, select: { id: true } });
  if (taken) throw new ServerError(409, POST_SLUG_TAKEN);
}

// toPostSlug is also the create form's web address rule (validation/post.js).
module.exports = { findFreeGallerySlug, findFreePostSlug, assertSlugAvailable, toPostSlug };
