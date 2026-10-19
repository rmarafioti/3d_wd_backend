// Zod schemas for posts: create, edit (full form submission) and status (archive / make active).
// A post's body is an ordered list of elements, each a paragraph or an image. Paragraph text is
// stored as typed; every [text](url) link in it is checked (docs/endpoints.md → Paragraph formatting).
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

// Optional on edit: existing images carry their id, new ones have none.
const itemId = z.preprocess(blankToUndefined, z.string().optional());

const imageShape = {
  src: httpsUrl('Image URL'),
  width: dimension('Width'),
  height: dimension('Height'),
  altText: requiredText('Alt text', 200),
};

// Link URLs follow the same https rule as image URLs.
const LINK_URL = httpsUrl('Link URL');

// The index of the first character from `start` that passes `isStop`, or text.length.
function scanTo(text, start, isStop) {
  let index = start;
  while (index < text.length && !isStop(text[index])) index += 1;
  return index;
}

// Every [link text](url) in a paragraph, left to right. Link text has no ] or line break; the URL
// has no whitespace and ends at the first ). Anything else is plain text.
// Each character is read about once, so a long paragraph of unmatched [ or ]( stays fast:
// - a [ whose link text never reaches ]( fails the same way for every [ before that point,
//   so the search skips past it;
// - a URL that ran out before a ) is remembered, and a later URL starting before that point
//   fails without being read again.
function findLinks(text) {
  const links = [];
  let urlStopAt = -1;
  let open = text.indexOf('[');
  while (open !== -1) {
    const close = scanTo(text, open + 1, (char) => char === ']' || char === '\n');
    let next = close + 1;
    if (text[close] === ']' && text[close + 1] === '(') {
      const urlStart = close + 2;
      const urlEnd =
        urlStart <= urlStopAt
          ? urlStopAt
          : scanTo(text, urlStart, (char) => char === ')' || /\s/.test(char));
      if (text[urlEnd] === ')') {
        links.push({ linkText: text.slice(open + 1, close), url: text.slice(urlStart, urlEnd) });
        next = urlEnd + 1;
      } else {
        urlStopAt = urlEnd;
      }
    }
    open = text.indexOf('[', next);
  }
  return links;
}

// The message for the first failing link in a paragraph, or null when every link passes.
// A link's text is checked before its URL.
function findLinkError(text) {
  for (const { linkText, url } of findLinks(text)) {
    const name = linkText.trim();
    if (!name) return 'Each link needs link text.';
    if (name.length > 100) return 'Link text must be 100 characters or fewer.';
    if (!LINK_URL.safeParse(url).success) {
      return 'Each link must be a valid URL starting with https://';
    }
  }
  return null;
}

const paragraphText = requiredText('Paragraph', 10000).superRefine((text, ctx) => {
  const message = findLinkError(text);
  if (message) ctx.addIssue({ code: 'custom', message });
});

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

const createPostSchema = z.object({
  websiteId: z.preprocess(blankToUndefined, z.string({ error: 'Website is required.' })),
  ...postFields,
  active: z.boolean({ error: 'Active must be true or false.' }).default(true),
  body: bodyList(z.object(imageShape, { error: 'Image is required.' })),
});

// websiteId and active are not part of the edit form; zod strips them if sent.
const updatePostSchema = z.object({
  ...postFields,
  body: bodyList(z.object({ id: itemId, ...imageShape }, { error: 'Image is required.' })),
});

const postStatusSchema = z.object({
  active: z.boolean({ error: 'Active must be true or false.' }),
});

module.exports = { createPostSchema, updatePostSchema, postStatusSchema };
