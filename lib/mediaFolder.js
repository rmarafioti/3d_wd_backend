// A website's media_folder, its Cloudinary upload folder: made once from its URL, -2 / -3 on a
// clash, never changed (docs/setup.md → Image Hosting).

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

// toMediaFolder is exported for its test of every docs/setup.md media_folder case.
module.exports = { toMediaFolder, findFreeMediaFolder };
