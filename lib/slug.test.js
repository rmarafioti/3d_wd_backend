// Tests for the gallery slug (lib/slug.js): a new code is drawn when the one drawn is already taken
// on the same website, which a request test can't force.
require('../testing/setup');
const crypto = require('node:crypto');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../prisma');
const { findFreeSlug } = require('./slug');
const { resetState, disconnect, createWebsite, createGallery } = require('../testing/helpers');

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
