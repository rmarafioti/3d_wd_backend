// A gallery's slug: 8 random lowercase letters and digits, made once when the gallery is created
// and unique within its website, deleted galleries included (docs/setup.md → Gallery slugs).
const crypto = require('node:crypto');

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 8;

// randomInt draws each character uniformly, so no letter or digit is more likely than another.
function generateSlug() {
  let slug = '';
  for (let i = 0; i < SLUG_LENGTH; i += 1) {
    slug += SLUG_ALPHABET[crypto.randomInt(SLUG_ALPHABET.length)];
  }
  return slug;
}

// The slug for a new gallery, inside the caller's transaction: a generated one no other gallery on
// this website has. A clash is about 1 in 2.8 trillion, so the loop almost always runs once.
async function findFreeSlug(tx, websiteId) {
  for (;;) {
    const slug = generateSlug();
    const taken = await tx.gallery.findFirst({ where: { websiteId, slug }, select: { id: true } });
    if (!taken) return slug;
  }
}

module.exports = { generateSlug, findFreeSlug };
