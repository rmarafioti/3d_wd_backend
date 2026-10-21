// A website's media_folder: the name of its Cloudinary upload folder, under the environment's
// root (CLOUDINARY_FOLDER). Set once when a website is created and never changed, so stored image
// URLs stay valid. The rule is in docs/setup.md → Image Hosting → media_folder; the migration that
// added the column backfilled existing websites with the same rule in SQL.

// Normalized URL → base folder name: the host (no port) without a leading "www.", its last label
// (the top-level domain) dropped, and the remaining dots turned into hyphens. A host with a single
// label keeps it whole. https://www.steviethedog.com → steviethedog,
// https://shop.example.co.uk → shop-example-co.
function toMediaFolder(url) {
  const labels = new URL(url).hostname.replace(/^www\./, '').split('.');
  if (labels.length > 1) labels.pop();
  return labels.join('-');
}

// The folder for a new website, inside the caller's transaction: the base name, or the first of
// base-2, base-3… that no other website has.
async function findFreeMediaFolder(tx, url) {
  const base = toMediaFolder(url);
  const taken = await tx.website.findMany({
    where: { mediaFolder: { startsWith: base } },
    select: { mediaFolder: true },
  });
  const takenFolders = new Set(taken.map((website) => website.mediaFolder));

  let folder = base;
  for (let n = 2; takenFolders.has(folder); n += 1) folder = `${base}-${n}`;
  return folder;
}

module.exports = { toMediaFolder, findFreeMediaFolder };
