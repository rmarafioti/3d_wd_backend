// Zod schemas for posts: create, edit (full form submission) and status (archive / make active).
// Optional text fields and postDate come out as null when blank, null or missing, so they are
// stored and returned as null. Limits match the Validation rules in docs/endpoints.md.
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

// Optional on edit: existing images/links carry their id, new ones have none.
const itemId = z.preprocess(blankToUndefined, z.string().optional());

const imageShape = {
  src: httpsUrl('Image URL'),
  width: dimension('Width'),
  height: dimension('Height'),
  altText: requiredText('Alt text', 200),
};

const linkShape = {
  name: requiredText('Link name', 100),
  url: httpsUrl('Link URL'),
};

function imageList(itemSchema) {
  return z
    .array(itemSchema, { error: 'Images must be a list.' })
    .max(5, 'A post can have at most 5 images.');
}

function linkList(itemSchema) {
  return z
    .array(itemSchema, { error: 'Links must be a list.' })
    .max(10, 'A post can have at most 10 links.');
}

const postFields = {
  postName: requiredText('Post name', 100),
  body: requiredText('Body', 5000),
  header: optionalText('Header', 150),
  subHeader: optionalText('Sub header', 200),
  postDate: z
    .preprocess(
      blankToUndefined,
      z.iso.date({ error: 'Enter a valid date (YYYY-MM-DD).' }).optional(),
    )
    .transform((value) => value ?? null),
};

const createPostSchema = z.object({
  websiteId: z.preprocess(blankToUndefined, z.string({ error: 'Website is required.' })),
  ...postFields,
  active: z.boolean({ error: 'Active must be true or false.' }).default(true),
  images: imageList(z.object(imageShape)),
  links: linkList(z.object(linkShape)),
});

// websiteId and active are not part of the edit form; zod strips them if sent.
const updatePostSchema = z.object({
  ...postFields,
  images: imageList(z.object({ id: itemId, ...imageShape })),
  links: linkList(z.object({ id: itemId, ...linkShape })),
});

const postStatusSchema = z.object({
  active: z.boolean({ error: 'Active must be true or false.' }),
});

module.exports = { createPostSchema, updatePostSchema, postStatusSchema };
