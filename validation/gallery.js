// Zod schemas for photo galleries: create, edit, status, the request message and the crop rules
// (docs/endpoints.md → Validation rules).
const { z } = require('zod');
const {
  requiredText,
  optionalText,
  itemId,
  websiteId,
  imageShape,
  publishAt,
  refinePublishAt,
} = require('./fields');

const MAX_IMAGES = 30;
const THUMBNAIL_CROP_MESSAGE = 'Thumbnail crop must be a square inside the image.';
const MOBILE_CROP_MESSAGE =
  'Mobile crop must be inside the image and at least as tall as it is wide.';
const THUMBNAILS_MESSAGE = 'Add a thumbnail crop to every image, or remove them all.';
const MOBILES_MESSAGE = 'Add a mobile crop to every image, or remove them all.';
const SHAPES_MESSAGE = 'Every mobile crop must be the same shape.';

// A crop's numbers are whole pixels: x and y from 0, width and height from 1. Whether it fits the
// image is checked on the image, which knows its own size. Absent or null is no crop.
function cropField(message) {
  const offset = z.number({ error: message }).int(message).min(0, message);
  const size = z.number({ error: message }).int(message).min(1, message);
  return z
    .object({ x: offset, y: offset, width: size, height: size }, { error: message })
    .nullish()
    .transform((crop) => crop ?? null);
}

function fitsImage(crop, image) {
  return crop.x + crop.width <= image.width && crop.y + crop.height <= image.height;
}

// Adds the crop's message on the crop itself (images.N.thumbnailCrop) when it doesn't fit the
// image, or doesn't have the shape it needs.
function refineCrops(image, ctx) {
  const { thumbnailCrop, mobileCrop } = image;
  const isSquare = thumbnailCrop && thumbnailCrop.width === thumbnailCrop.height;
  if (thumbnailCrop && !(isSquare && fitsImage(thumbnailCrop, image))) {
    ctx.addIssue({ code: 'custom', path: ['thumbnailCrop'], message: THUMBNAIL_CROP_MESSAGE });
  }
  const isPortrait = mobileCrop && mobileCrop.height >= mobileCrop.width;
  if (mobileCrop && !(isPortrait && fitsImage(mobileCrop, image))) {
    ctx.addIssue({ code: 'custom', path: ['mobileCrop'], message: MOBILE_CROP_MESSAGE });
  }
}

// Two crops have the same shape when their width / height are within 1%, which allows for
// whole-pixel rounding (a 4:5 crop scaled to 750 × 938). The frontend's sameShape is the same rule.
function sameShape(a, b) {
  const ratio = b.width / b.height;
  return Math.abs(a.width / a.height - ratio) <= ratio * 0.01;
}

// The gallery-wide crop rules, on the images list itself (images). The first mobile crop in list
// order sets the shape the others must match.
function refineCropConsistency(images, ctx) {
  const addIssue = (message) => ctx.addIssue({ code: 'custom', path: [], message });
  const thumbnails = images.filter((image) => image.thumbnailCrop);
  if (thumbnails.length > 0 && thumbnails.length < images.length) addIssue(THUMBNAILS_MESSAGE);

  const mobiles = images.map((image) => image.mobileCrop).filter(Boolean);
  if (mobiles.length > 0 && mobiles.length < images.length) addIssue(MOBILES_MESSAGE);
  if (mobiles.some((crop) => !sameShape(crop, mobiles[0]))) addIssue(SHAPES_MESSAGE);
}

const galleryImageShape = {
  ...imageShape,
  caption: optionalText('Caption', 300),
  thumbnailCrop: cropField(THUMBNAIL_CROP_MESSAGE),
  mobileCrop: cropField(MOBILE_CROP_MESSAGE),
};

function imageList(shape) {
  const image = z.object(shape, { error: 'Image is required.' }).superRefine(refineCrops);
  return (
    z
      .array(image, { error: 'Images must be a list.' })
      .min(1, 'Add at least one image.')
      .max(MAX_IMAGES, `A gallery can have at most ${MAX_IMAGES} images.`)
      // Only once every image passed its own checks, so the rules read crops that are whole.
      .superRefine(refineCropConsistency, { when: (payload) => payload.issues.length === 0 })
  );
}

const galleryFields = {
  galleryName: requiredText('Gallery name', 100),
  title: optionalText('Title', 150),
  copy: optionalText('Copy', 2000),
};

const status = z.enum(['draft', 'published'], { error: 'Status must be draft or published.' });

// A new gallery is published unless the request says otherwise.
// A go-live date is only for a draft (validation/fields.js → refinePublishAt).
const createGallerySchema = z
  .object({
    websiteId,
    ...galleryFields,
    status: status.default('published'),
    publishAt,
    images: imageList(galleryImageShape),
  })
  .superRefine(refinePublishAt, { when: (payload) => payload.issues.length === 0 });

// websiteId, status and slug are not part of the edit form; zod strips them if sent.
const updateGallerySchema = z.object({
  ...galleryFields,
  publishAt,
  images: imageList({ id: itemId, ...galleryImageShape }),
});

const galleryStatusSchema = z.object({ status });

// The request message sent once after a gallery is created: where on the site it should go.
const requestGallerySchema = z.object({ requestNote: requiredText('Request note', 1000) });

// The admin's Set a Gallery Live: live is the only placement the admin sets.
const galleryPlacementSchema = z.object({
  placement: z.literal('live', { error: 'Placement must be live.' }),
});

module.exports = {
  createGallerySchema,
  updateGallerySchema,
  galleryStatusSchema,
  requestGallerySchema,
  galleryPlacementSchema,
};
