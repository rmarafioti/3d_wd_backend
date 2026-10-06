// Zod schemas for site owner accounts. createAccountSchema is the full Create an Account body:
// the account's own fields plus the website choice from validation/website.js.
const { z } = require('zod');
const { blankToUndefined } = require('./validate');
const { websiteChoiceShape, refineWebsiteChoice } = require('./website');

const accountShape = {
  name: z.preprocess(
    blankToUndefined,
    z.string({ error: 'Name is required.' }).max(100, 'Name must be 100 characters or fewer.'),
  ),
  // Lowercased before validation, so it is compared and stored lowercase.
  email: z.preprocess(
    (value) => {
      const trimmed = blankToUndefined(value);
      return typeof trimmed === 'string' ? trimmed.toLowerCase() : trimmed;
    },
    z.email({
      error: (issue) =>
        issue.input === undefined ? 'Email is required.' : 'Enter a valid email address.',
    }),
  ),
};

const createAccountSchema = z
  .object({ ...accountShape, ...websiteChoiceShape })
  .superRefine(refineWebsiteChoice);

module.exports = { accountShape, createAccountSchema };
