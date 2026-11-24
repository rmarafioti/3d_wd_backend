// Tests for slugs (lib/slug.js): a gallery code drawn again when taken, which a request test can't
// force; every post slug rule; and the add_post_slug backfill agreeing with toPostSlug.
require('../testing/setup');
const crypto = require('node:crypto');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../prisma');
const { findFreeGallerySlug, toPostSlug } = require('./slug');
const {
  resetState,
  disconnect,
  createWebsite,
  createGallery,
  createPost,
  runMigrationBackfill,
} = require('../testing/helpers');

after(disconnect);

describe('findFreeGallerySlug', () => {
  beforeEach(resetState);

  it("draws again when the website already has the code, a deleted gallery's included", async (t) => {
    const { website } = await createWebsite();
    await createGallery(website, { slug: 'aaaaaaaa', deletedAt: new Date() });
    // The first 8 draws give "aaaaaaaa" (index 0), the next 8 give "bbbbbbbb" (index 1).
    let draws = 0;
    t.mock.method(crypto, 'randomInt', () => (draws++ < 8 ? 0 : 1));

    assert.equal(await findFreeGallerySlug(prisma, website.id), 'bbbbbbbb');
  });

  it('keeps a code only another website has', async (t) => {
    const { website } = await createWebsite();
    const { website: other } = await createWebsite();
    await createGallery(other, { slug: 'aaaaaaaa' });
    t.mock.method(crypto, 'randomInt', () => 0);

    assert.equal(await findFreeGallerySlug(prisma, website.id), 'aaaaaaaa');
  });
});

describe('toPostSlug', () => {
  it('removes accents and lowercases', () => {
    assert.equal(toPostSlug('Café Ñandú Über Ação'), 'cafe-nandu-uber-acao');
  });

  it('turns every run of other characters into one hyphen and trims the ends', () => {
    assert.equal(toPostSlug('  Why dbt tests matter! (Part 2)  '), 'why-dbt-tests-matter-part-2');
  });

  it("turns a letter that doesn't decompose into a hyphen", () => {
    assert.equal(toPostSlug('Straße'), 'stra-e');
  });

  it('keeps a slug of exactly 60 characters whole', () => {
    const header = `${'a'.repeat(29)} ${'b'.repeat(30)}`;

    assert.equal(toPostSlug(header), `${'a'.repeat(29)}-${'b'.repeat(30)}`);
  });

  it('cuts a longer header at the last word boundary within 60 characters', () => {
    const slug = toPostSlug('word '.repeat(20));

    assert.equal(slug, Array(12).fill('word').join('-'));
    assert.ok(slug.length <= 60);
  });

  it('keeps a word that ends exactly at 60 characters', () => {
    const header = `${'a'.repeat(60)} more`;

    assert.equal(toPostSlug(header), 'a'.repeat(60));
  });

  it('cuts a single word longer than 60 characters at 60', () => {
    assert.equal(toPostSlug('x'.repeat(70)), 'x'.repeat(60));
  });

  it('returns null for no header, or one with no letter or digit', () => {
    for (const header of [null, undefined, '', '!!!', '🐶🐾', '—']) {
      assert.equal(toPostSlug(header), null, `header ${JSON.stringify(header)}`);
    }
  });
});

describe('add_post_slug backfill', () => {
  beforeEach(resetState);

  it("gives each post toPostSlug of its header, -2 on a later clash, and keeps a header-less post's code", async () => {
    const { website } = await createWebsite();
    const { website: other } = await createWebsite();
    const at = (minute) => new Date(`2026-10-01T00:0${minute}:00.000Z`);
    const longHeader = 'An honest look at why analytics engineers should test every dbt model';
    const first = await createPost(website, {
      header: 'Café Ñandú',
      slug: 'p1',
      createdAt: at(1),
      deletedAt: new Date(),
    });
    const second = await createPost(website, {
      header: 'cafe nandu!',
      slug: 'p2',
      createdAt: at(2),
    });
    const long = await createPost(website, { header: longHeader, slug: 'p3', createdAt: at(3) });
    const symbols = await createPost(website, {
      header: '!!!',
      slug: 'k3x9p2qa',
      createdAt: at(4),
    });
    const none = await createPost(website, { header: null, slug: 'z8y7x6w5', createdAt: at(5) });
    const elsewhere = await createPost(other, {
      header: 'Café Ñandú',
      slug: 'p4',
      createdAt: at(6),
    });

    await runMigrationBackfill('add_post_slug');

    const slugOf = async (post) =>
      (await prisma.post.findUnique({ where: { id: post.id }, select: { slug: true } })).slug;
    assert.equal(await slugOf(first), toPostSlug('Café Ñandú'));
    assert.equal(await slugOf(second), `${toPostSlug('cafe nandu!')}-2`);
    assert.equal(await slugOf(long), toPostSlug(longHeader));
    assert.equal(await slugOf(symbols), 'k3x9p2qa');
    assert.equal(await slugOf(none), 'z8y7x6w5');
    assert.equal(await slugOf(elsewhere), 'cafe-nandu');
  });
});
