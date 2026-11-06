// Zod field builders shared by the post, gallery, upload and list query schemas, so a rule more
// than one uses can't drift between them.
const { z } = require('zod');
const { blankToUndefined } = require('./validate');

const DEFAULT_PAGE_SIZE = 50;

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

// The website a post or gallery is created for, or an upload is signed for.
const websiteId = z.preprocess(blankToUndefined, z.string({ error: 'Website is required.' }));

// An uploaded image's fields, the same in a post body and a gallery.
const imageShape = {
  src: httpsUrl('Image URL'),
  width: dimension('Width'),
  height: dimension('Height'),
  altText: requiredText('Alt text', 200),
};

// A paginated list's query (docs/scaling.md §6). Every query value arrives as a string: `limit` is
// coerced to a number, and a parameter sent twice (an array) fails its check. Both are optional;
// `limit` defaults to DEFAULT_PAGE_SIZE.
const pageShape = {
  limit: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: 'Limit must be a whole number from 1 to 100.' })
      .int('Limit must be a whole number from 1 to 100.')
      .min(1, 'Limit must be a whole number from 1 to 100.')
      .max(100, 'Limit must be a whole number from 1 to 100.')
      .default(DEFAULT_PAGE_SIZE),
  ),
  // The nextCursor of the previous page: the id of its last item.
  cursor: z.preprocess(blankToUndefined, z.uuid({ error: 'Invalid cursor.' }).optional()),
};

module.exports = {
  requiredText,
  optionalText,
  httpsUrl,
  itemId,
  websiteId,
  imageShape,
  pageShape,
};
