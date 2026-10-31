// Zod field builders shared by the post and gallery schemas, so a rule both use (a required or
// optional text field, an https URL, an item id, an uploaded image's fields) can't drift between them.
// Text is trimmed and blank counts as empty (blankToUndefined); optional text comes out as null.
const { z } = require('zod');
const { blankToUndefined } = require('./validate');

function requiredText(label, max) {
  return z.preprocess(
    blankToUndefined,
    z
      .string({ error: `${label} is required.` })
      .max(max, `${label} must be ${max} characters or fewer.`),
  );
}

function optionalText(label, max) {
  return z
    .preprocess(
      blankToUndefined,
      z.string().max(max, `${label} must be ${max} characters or fewer.`).optional(),
    )
    .transform((value) => value ?? null);
}

function httpsUrl(label) {
  return z.preprocess(
    blankToUndefined,
    z.url({
      protocol: /^https$/,
      error: (issue) =>
        issue.input === undefined
          ? `${label} is required.`
          : 'Must be a valid URL starting with https://',
    }),
  );
}

// Image width/height: whole numbers 1–10000 (next/image on the client website needs them).
function dimension(label) {
  const message = `${label} must be a whole number between 1 and 10000.`;
  return z.number({ error: message }).int(message).min(1, message).max(10000, message);
}

// Optional on edit: existing items carry their id, new ones have none.
const itemId = z.preprocess(blankToUndefined, z.string().optional());

// An uploaded image's fields, the same in a post body and a gallery.
const imageShape = {
  src: httpsUrl('Image URL'),
  width: dimension('Width'),
  height: dimension('Height'),
  altText: requiredText('Alt text', 200),
};

module.exports = { requiredText, optionalText, httpsUrl, itemId, imageShape };
