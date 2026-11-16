// Zod schemas for site owner accounts. createAccountSchema is the full Create an Account body:
// the account's own fields plus the website choice from validation/website.js.
const { z } = require('zod');
const { blankToUndefined } = require('./validate');
const { email } = require('./fields');
const { websiteChoiceShape, refineWebsiteChoice } = require('./website');

const accountShape = {
  name: z.preprocess(
    blankToUndefined,
    z.string({ error: 'Name is required.' }).max(100, 'Name must be 100 characters or fewer.'),
  ),
  email,
};

const createAccountSchema = z
  .object({ ...accountShape, ...websiteChoiceShape })
  .superRefine(refineWebsiteChoice);

module.exports = { createAccountSchema };
