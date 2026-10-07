// Zod schemas for choosing a website on Create an Account and Link a Website:
// the body carries either { websiteId } (link an existing website) or { websiteName, websiteUrl }
// (create a new one) — exactly one of the two, never both, never neither.
const { z } = require('zod');
const { blankToUndefined } = require('./validate');

const websiteChoiceShape = {
  websiteId: z.preprocess(blankToUndefined, z.string().optional()),
  websiteName: z.preprocess(
    blankToUndefined,
    z.string().max(100, 'Website name must be 100 characters or fewer.').optional(),
  ),
  websiteUrl: z.preprocess(
    blankToUndefined,
    z.url({ protocol: /^https$/, error: 'Must be a valid URL starting with https://' }).optional(),
  ),
};

// Enforces "exactly one of websiteId or (websiteName + websiteUrl)". Errors are attached to a
// field so the form can show them next to the right input.
function refineWebsiteChoice(data, ctx) {
  const hasId = data.websiteId !== undefined;
  const hasNewWebsite = data.websiteName !== undefined || data.websiteUrl !== undefined;

  if (hasId === hasNewWebsite) {
    ctx.addIssue({
      code: 'custom',
      path: ['websiteId'],
      message: hasId
        ? 'Select an existing website or enter a new one, not both.'
        : 'Select a website or enter a new one.',
    });
    return;
  }
  if (hasNewWebsite) {
    if (data.websiteName === undefined) {
      ctx.addIssue({ code: 'custom', path: ['websiteName'], message: 'Website name is required.' });
    }
    if (data.websiteUrl === undefined) {
      ctx.addIssue({ code: 'custom', path: ['websiteUrl'], message: 'Website URL is required.' });
    }
  }
}

const websiteChoiceSchema = z.object(websiteChoiceShape).superRefine(refineWebsiteChoice);

module.exports = { websiteChoiceShape, refineWebsiteChoice, websiteChoiceSchema };
