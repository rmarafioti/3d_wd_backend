// A gallery's slug: the short, URL-safe name a client website asks for it by
// (GET /api/public/galleries/:slug). Made from the gallery's name once, when the gallery is
// created, and never changed, so renaming a gallery never breaks the website that shows it.
// Unique within its website, deleted galleries included, so a slug is never reused. The rule is in
// docs/setup.md → Gallery slugs.

const MAX_LENGTH = 60;
const FALLBACK = 'gallery';

// Gallery name → base slug: lowercase, accents removed, every run of anything but a-z and 0-9
// turned into one hyphen, no hyphen at either end, at most 60 characters. A name with nothing
// left (only symbols) becomes "gallery". "Our Interior!" → our-interior, "Café Art" → cafe-art.
function toSlug(name) {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_LENGTH)
    .replace(/^-+|-+$/g, '');
  return slug || FALLBACK;
}

// The slug for a new gallery, inside the caller's transaction: the base slug, or the first of
// base-2, base-3… that no other gallery on this website has.
async function findFreeSlug(tx, websiteId, name) {
  const base = toSlug(name);
  const taken = await tx.gallery.findMany({
    where: { websiteId, slug: { startsWith: base } },
    select: { slug: true },
  });
  const takenSlugs = new Set(taken.map((gallery) => gallery.slug));

  let slug = base;
  for (let n = 2; takenSlugs.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

module.exports = { toSlug, findFreeSlug };
