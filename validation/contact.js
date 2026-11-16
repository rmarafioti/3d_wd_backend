// Zod schema for the landing page's contact form (POST /api/contact), and its honeypot check, which
// the route runs first.
const { z } = require('zod');
const { blankToUndefined } = require('./validate');
const { requiredText, email } = require('./fields');

const GOAL_MAX = 2000;

const contactSchema = z.object({
  name: requiredText('Name', 100),
  business: requiredText('Business name', 100),
  email,
  startingPoint: z.enum(['has_website', 'unfinished_website', 'no_website'], {
    error: "Choose where you're starting from.",
  }),
  // The form's question is "What do you want your site to do?", so its messages answer it rather
  // than name a field. Line breaks are kept.
  goal: z.preprocess(
    blankToUndefined,
    z
      .string({ error: 'Tell me what you want your site to do.' })
      .max(GOAL_MAX, `Your answer must be ${GOAL_MAX} characters or fewer.`),
  ),
});

// True when the hidden contactCode field holds anything: only a bot fills it (docs/endpoints.md →
// Contact form). Any value counts, a string or not.
function hasHoneypot(body) {
  return blankToUndefined(body?.contactCode) !== undefined;
}

module.exports = { contactSchema, hasHoneypot };
