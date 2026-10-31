// Tests for the gallery slug rule (lib/slug.js): every case in docs/setup.md → Gallery slugs, and
// the -2, -3… suffix when a slug is taken on the same website (other websites don't count).
require('../testing/setup');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../prisma');
const { toSlug, findFreeSlug } = require('./slug');
const { resetState, disconnect, createWebsite, createGallery } = require('../testing/helpers');

describe('toSlug', () => {
  const cases = [
    ['Our Interior', 'our-interior'],
    ['  Our   Interior!  ', 'our-interior'],
    ['Café Art', 'cafe-art'],
    ['Art & Prints 2026', 'art-prints-2026'],
    ['---Portfolio---', 'portfolio'],
    ['!!!', 'gallery'],
    ['🐶', 'gallery'],
    [`${'a'.repeat(59)} b`, 'a'.repeat(59)],
  ];

  for (const [name, slug] of cases) {
    it(`turns "${name}" into ${slug}`, () => {
      assert.equal(toSlug(name), slug);
    });
  }
});

describe('findFreeSlug', () => {
  beforeEach(resetState);
  after(disconnect);

  it('returns the base slug when only another website has it', async () => {
    const { website } = await createWebsite();
    const { website: other } = await createWebsite();
    await createGallery(other, { slug: 'interior' });
    await createGallery(website, { slug: 'interiors' });

    assert.equal(await findFreeSlug(prisma, website.id, 'Interior'), 'interior');
  });

  it('adds the first free number when the base slug is taken', async () => {
    const { website } = await createWebsite();
    await createGallery(website, { slug: 'interior' });
    await createGallery(website, { slug: 'interior-3' });

    assert.equal(await findFreeSlug(prisma, website.id, 'Interior'), 'interior-2');
  });
});
