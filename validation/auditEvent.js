// Zod schema for the admin's audit event list query (GET /api/admin/auditEvents).
const { z } = require('zod');
const { blankToUndefined } = require('./validate');
const { pageShape } = require('./fields');

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

// An ISO 8601 instant ("2026-11-05T05:00:00.000Z"), turned into a Date.
const instant = z.preprocess(
  blankToUndefined,
  z.iso
    .datetime({ offset: true, error: 'Enter a valid date and time.' })
    .transform((value) => new Date(value))
    .optional(),
);

// from and to come as a pair, to after from, at most 31 days apart, so a range never reads more
// than a month does.
function refineRange({ from, to }, ctx) {
  if (!from && !to) return;
  if (!from || !to) {
    ctx.addIssue({
      code: 'custom',
      path: [from ? 'to' : 'from'],
      message: 'Send from and to together.',
    });
    return;
  }
  if (to <= from) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'To must be after from.' });
    return;
  }
  if (to - from > MAX_RANGE_MS) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'The range can be at most 31 days.' });
  }
}

// Every query value arrives as a string, and a parameter sent twice (an array) fails its string
// check. All are optional: month defaults in the route, limit in pageShape (with cursor).
const listAuditEventsSchema = z
  .object({
    // A UTC calendar month, YYYY-MM.
    month: z.preprocess(
      blankToUndefined,
      z
        .string({ error: 'Enter a month as YYYY-MM.' })
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter a month as YYYY-MM.')
        .optional(),
    ),
    ...pageShape,
    // A time range [from, to), sent together; month is ignored when it is given.
    from: instant,
    to: instant,
  })
  .superRefine(refineRange, { when: (payload) => payload.issues.length === 0 });

module.exports = { listAuditEventsSchema };
