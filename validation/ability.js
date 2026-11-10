// Zod schemas for a website's abilities: add one, turn it on or off, and the admin setting it live.
// The request form's body is requestNoteSchema (validation/fields.js).
const { z } = require('zod');
const { websiteId } = require('./fields');

const addAbilitySchema = z.object({
  websiteId,
  kind: z.enum(['posts', 'galleries'], { error: 'Choose posts or galleries.' }),
});

const turnedOnSchema = z.object({
  turnedOn: z.boolean({ error: 'Turned on must be true or false.' }),
});

// Only live for now: the admin sets an ability live once its code is wired into the client website.
const abilityStatusSchema = z.object({
  status: z.literal('live', { error: 'Status must be live.' }),
});

module.exports = { addAbilitySchema, turnedOnSchema, abilityStatusSchema };
