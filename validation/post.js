// Zod schemas for posts: create, edit and status, with a body of paragraph and image elements
// (docs/endpoints.md → Validation rules).
const { z } = require('zod');
const { blankToUndefined } = require('./validate');
const {
  requiredText,
  optionalText,
  formattedText,
  itemId,
  websiteId,
  imageShape,
  status,
  publishAt,
  refinePublishAt,
} = require('./fields');
const { toPostSlug } = require('../lib/slug');

const paragraphText = formattedText('Paragraph', 10000);

// The body: paragraph and image elements in reading order. The limits count each type across the
// whole list, so their messages sit under the list name ("body").
function bodyList(imageSchema) {
  const element = z.discriminatedUnion(
    'type',
    [
      z.object({ type: z.literal('paragraph'), text: paragraphText }),
      z.object({ type: z.literal('image'), image: imageSchema }),
    ],
    { error: 'Element type must be paragraph or image.' },
  );

  return z.array(element, { error: 'Body must be a list.' }).superRefine((elements, ctx) => {
    const paragraphs = elements.filter((item) => item.type === 'paragraph').length;
    const images = elements.length - paragraphs;
    if (paragraphs === 0) ctx.addIssue({ code: 'custom', message: 'Add at least one paragraph.' });
    if (paragraphs > 5) {
      ctx.addIssue({ code: 'custom', message: 'A post can have at most 5 paragraphs.' });
    }
    if (images > 5) ctx.addIssue({ code: 'custom', message: 'A post can have at most 5 images.' });
  });
}

const postFields = {
  postName: requiredText('Post name', 100),
  header: optionalText('Header', 150),
  subHeader: optionalText('Sub header', 200),
  postDate: z
    .preprocess(
      blankToUndefined,
      z.iso.date({ error: 'Enter a valid date (YYYY-MM-DD).' }).optional(),
    )
    .transform((value) => value ?? null),
};

// The web address the site owner may enter on create, put in slug form (lib/slug.js →
// toPostSlug), so capitals and spaces become lowercase and hyphens, not a 400. Its length is
// checked as typed, since slug form only ever shortens it. Blank is null: made from the header.
const postSlug = optionalText('Web address', 60).transform((value, ctx) => {
  if (value === null) return null;
  const slug = toPostSlug(value);
  if (slug) return slug;
  ctx.addIssue({ code: 'custom', message: 'Web address needs at least one letter or digit.' });
  return z.NEVER;
});

// A new post is published unless the request says otherwise.
// A go-live date is only for a draft (validation/fields.js → refinePublishAt).
const createPostSchema = z
  .object({
    websiteId,
    ...postFields,
    slug: postSlug,
    status: status.default('published'),
    publishAt,
    body: bodyList(z.object(imageShape, { error: 'Image is required.' })),
  })
  .superRefine(refinePublishAt, { when: (payload) => payload.issues.length === 0 });

// websiteId, slug and status are not part of the edit form; zod strips them if sent.
const updatePostSchema = z.object({
  ...postFields,
  publishAt,
  body: bodyList(z.object({ id: itemId, ...imageShape }, { error: 'Image is required.' })),
});

const postStatusSchema = z.object({ status });

module.exports = { createPostSchema, updatePostSchema, postStatusSchema };
