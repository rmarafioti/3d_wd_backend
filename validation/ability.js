// Zod schemas for a website's abilities: add one (Posts or Photo Galleries), send its request
// form, turn it on or off, and the admin setting it live. Limits match the Validation rules in
// docs/endpoints.md.
const { z } = require('zod');
const { requiredText, websiteId } = require('./fields');

const addAbilitySchema = z.object({
  websiteId,
  kind: z.enum(['posts', 'galleries'], { error: 'Choose posts or galleries.' }),
});

// The request form: where on the client website the ability's content should appear. Line breaks
// are kept.
const requestAbilitySchema = z.object({ requestNote: requiredText('Request note', 1000) });

const turnedOnSchema = z.object({
  turnedOn: z.boolean({ error: 'Turned on must be true or false.' }),
});

// Only live for now: the admin sets an ability live once its code is wired into the client website.
const abilityStatusSchema = z.object({
  status: z.literal('live', { error: 'Status must be live.' }),
});

module.exports = { addAbilitySchema, requestAbilitySchema, turnedOnSchema, abilityStatusSchema };
