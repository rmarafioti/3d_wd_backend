// Gallery image crops between the database's four columns per crop and the API's Crop object, and
// the cropped versions the public route returns.
const { croppedSrc } = require('./cloudinary');

// The crop columns, for any select that reads crops. `kind` below is their prefix: 'thumbnail'
// or 'mobile'.
const CROP_SELECT = {
  thumbnailX: true,
  thumbnailY: true,
  thumbnailWidth: true,
  thumbnailHeight: true,
  mobileX: true,
  mobileY: true,
  mobileWidth: true,
  mobileHeight: true,
};

// One crop ({ x, y, width, height } or null) → its four columns, all set or all null.
function cropColumns(kind, crop) {
  return {
    [`${kind}X`]: crop?.x ?? null,
    [`${kind}Y`]: crop?.y ?? null,
    [`${kind}Width`]: crop?.width ?? null,
    [`${kind}Height`]: crop?.height ?? null,
  };
}

// A validated image's two crops → its eight crop columns.
function toCropColumns({ thumbnailCrop, mobileCrop }) {
  return { ...cropColumns('thumbnail', thumbnailCrop), ...cropColumns('mobile', mobileCrop) };
}

// One kind of crop from a row selected with CROP_SELECT → { x, y, width, height }, or null when
// the image has none. The columns are written together, so one null means all four are.
function toCrop(row, kind) {
  if (row[`${kind}X`] === null) return null;
  return {
    x: row[`${kind}X`],
    y: row[`${kind}Y`],
    width: row[`${kind}Width`],
    height: row[`${kind}Height`],
  };
}

// The cropped version of an image for a client website: its URL and exact size, or null.
function toCroppedImage(row, kind) {
  const crop = toCrop(row, kind);
  if (!crop) return null;
  return { src: croppedSrc(row.src, crop), width: crop.width, height: crop.height };
}

module.exports = { CROP_SELECT, toCropColumns, toCrop, toCroppedImage };
