// Zod schemas for posts: create, edit (full form submission) and status (draft / published).
// A post's status is `status` ('draft' or 'published'). The older boolean `active` is still
// accepted until it is retired (Feature 8, expand → migrate → contract); both schemas turn either
// one into `status`, and a request whose two values disagree is a 400 on `status`.
// A post's body is an ordered list of elements, each a paragraph or an image. Paragraph text is
// stored as typed; every [text](url) link in it is checked (docs/endpoints.md → Paragraph
// formatting).
// Optional text fields and postDate come out as null when blank, null or missing, so they are
// stored and returned as null. Limits match the Validation rules in docs/endpoints.md.
const { z } = require('zod');
const { blankToUndefined } = require('./validate');
const { requiredText, optionalText, httpsUrl, itemId, websiteId, imageShape } = require('./fields');

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

// Status, plus the legacy active it replaces. Both are optional here; each schema decides what
// happens when neither is sent.
const statusShape = {
  active: z.boolean({ error: 'Active must be true or false.' }).optional(),
  status: z
    .enum(['draft', 'published'], { error: 'Status must be draft or published.' })
    .optional(),
};

function statusFromActive(active) {
  return active ? 'published' : 'draft';
}

// A request may send status, active or both, but both must say the same thing.
function refineStatusChoice(data, ctx) {
  const hasBoth = data.status !== undefined && data.active !== undefined;
  if (hasBoth && data.status !== statusFromActive(data.active)) {
    ctx.addIssue({ code: 'custom', path: ['status'], message: "Status and active don't match." });
  }
}

// Collapses status and active into status alone: status when sent, else from active, else
// `fallback`.
function toStatusInput({ active, status, ...input }, fallback) {
  const resolved = status ?? (active === undefined ? fallback : statusFromActive(active));
  return { ...input, status: resolved };
}

// A new post is published unless the request says otherwise.
const createPostSchema = z
  .object({
    websiteId,
    ...postFields,
    ...statusShape,
    body: bodyList(z.object(imageShape, { error: 'Image is required.' })),
  })
  .superRefine(refineStatusChoice)
  .transform((input) => toStatusInput(input, 'published'));

// websiteId, status and active are not part of the edit form; zod strips them if sent.
const updatePostSchema = z.object({
  ...postFields,
  body: bodyList(z.object({ id: itemId, ...imageShape }, { error: 'Image is required.' })),
});

// The status route needs one of the two.
const postStatusSchema = z
  .object(statusShape)
  .superRefine((data, ctx) => {
    if (data.status === undefined && data.active === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Status must be draft or published.',
      });
      return;
    }
    refineStatusChoice(data, ctx);
  })
  .transform((input) => toStatusInput(input));

module.exports = { createPostSchema, updatePostSchema, postStatusSchema };
