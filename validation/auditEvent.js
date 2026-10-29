// Zod schema for the admin's audit event list (GET /api/admin/auditEvents). It reads the query
// string, so every value arrives as a string: `limit` is coerced to a number, and a parameter sent
// twice (an array) fails its string check. All three are optional; the route fills the defaults.
const { z } = require('zod');
const { blankToUndefined } = require('./validate');

const listAuditEventsSchema = z.object({
  // A UTC calendar month, YYYY-MM.
  month: z.preprocess(
    blankToUndefined,
    z
      .string({ error: 'Enter a month as YYYY-MM.' })
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter a month as YYYY-MM.')
      .optional(),
  ),
  limit: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: 'Limit must be a whole number from 1 to 100.' })
      .int('Limit must be a whole number from 1 to 100.')
      .min(1, 'Limit must be a whole number from 1 to 100.')
      .max(100, 'Limit must be a whole number from 1 to 100.')
      .optional(),
  ),
  // The nextCursor of the previous page: the id of its last (oldest) event.
  cursor: z.preprocess(blankToUndefined, z.uuid({ error: 'Invalid cursor.' }).optional()),
});

module.exports = { listAuditEventsSchema };
