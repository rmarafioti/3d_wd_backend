// Tests for the gallery slug (lib/slug.js): 8 random lowercase letters and digits, and a new one
// when the code drawn is already taken on the same website.
require('../testing/setup');
const crypto = require('node:crypto');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../prisma');
const { generateSlug, findFreeSlug } = require('./slug');
const { resetState, disconnect, createWebsite, createGallery } = require('../testing/helpers');

describe('generateSlug', () => {
  it('makes 8 lowercase letters and digits, different each time', () => {
    const slugs = Array.from({ length: 20 }, generateSlug);

    for (const slug of slugs) assert.match(slug, /^[a-z0-9]{8}$/);
    assert.equal(new Set(slugs).size, slugs.length);
  });
});

describe('findFreeSlug', () => {
  beforeEach(resetState);
  after(disconnect);

  it("draws again when the website already has the code, a deleted gallery's included", async (t) => {
    const { website } = await createWebsite();
    await createGallery(website, { slug: 'aaaaaaaa', deletedAt: new Date() });
    // The first 8 draws give "aaaaaaaa" (index 0), the next 8 give "bbbbbbbb" (index 1).
    let draws = 0;
    t.mock.method(crypto, 'randomInt', () => (draws++ < 8 ? 0 : 1));

    assert.equal(await findFreeSlug(prisma, website.id), 'bbbbbbbb');
  });

  it('keeps a code only another website has', async (t) => {
    const { website } = await createWebsite();
    const { website: other } = await createWebsite();
    await createGallery(other, { slug: 'aaaaaaaa' });
    t.mock.method(crypto, 'randomInt', () => 0);

    assert.equal(await findFreeSlug(prisma, website.id), 'aaaaaaaa');
  });
});
