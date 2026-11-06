// Zod field builders shared by the post, gallery, upload and list query schemas, and the go-live
// date checks, so a rule more than one uses can't drift between them.
const { z } = require('zod');
const { blankToUndefined } = require('./validate');
const { ServerError } = require('../errors');

const DEFAULT_PAGE_SIZE = 50;
const PUBLISH_AT_DRAFT_ONLY = 'Only a draft can have a go-live date.';
const PUBLISH_AT_IN_FUTURE = 'Pick a go-live date after today.';

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

// An ISO 8601 instant with an offset ("2026-11-20T14:00:00.000Z"), turned into a Date.
const isoInstant = z.iso
  .datetime({ offset: true, error: 'Enter a valid date and time.' })
  .transform((value) => new Date(value));

// A draft's go-live date. Absent stays undefined (edit leaves it unchanged, for frontends that
// don't send it), while null or blank is null (cleared).
const publishAt = z.preprocess(
  (value) => (value === undefined ? undefined : (blankToUndefined(value) ?? null)),
  isoInstant.nullable().optional(),
);

// The body of a post's or gallery's Set publish date route: publishAt is required, as a date or
// null to clear it.
const publishAtSchema = z.object({
  publishAt: z.preprocess(
    (value) => (value === undefined ? undefined : (blankToUndefined(value) ?? null)),
    isoInstant.nullable(),
  ),
});

// Why a go-live date can't be saved on an item with this status, or null if it can. The date is
// sent as midnight local time, so today's has already passed. One that has passed is accepted only
// when it is the one already stored, so a form resent between two runs of the scheduled publish job
// doesn't fail on a field the site owner didn't touch.
function publishAtProblem(value, status, storedPublishAt = null) {
  if (!value) return null;
  if (status === 'published') return PUBLISH_AT_DRAFT_ONLY;
  if (value > new Date()) return null;
  if (storedPublishAt && value.getTime() === storedPublishAt.getTime()) return null;
  return PUBLISH_AT_IN_FUTURE;
}

// Create: the status is in the body.
function refinePublishAt(input, ctx) {
  const message = publishAtProblem(input.publishAt, input.status);
  if (message) ctx.addIssue({ code: 'custom', path: ['publishAt'], message });
}

// Edit: the body has no status, so the stored item's status and go-live date decide.
function assertPublishAtAllowed(value, stored) {
  const message = publishAtProblem(value, stored.status, stored.publishAt);
  if (message)
    throw new ServerError(400, 'Please fix the highlighted fields.', { publishAt: message });
}

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
  isoInstant,
  publishAt,
  publishAtSchema,
  refinePublishAt,
  assertPublishAtAllowed,
};
