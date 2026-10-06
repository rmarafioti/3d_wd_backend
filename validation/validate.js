// Shared validation helper. Every route runs its zod schema through validate(), so a failed
// check always leaves the server as the same 400 envelope:
// { error: { message: 'Please fix the highlighted fields.', fields: { fieldName: 'message' } } }
const { z } = require('zod');
const { ServerError } = require('../errors');

// Returns the parsed (trimmed, transformed) data, or throws the 400 with one message per field.
function validate(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const fields = {};
  for (const [field, messages] of Object.entries(z.flattenError(result.error).fieldErrors)) {
    if (messages?.length) fields[field] = messages[0];
  }
  throw new ServerError(
    400,
    'Please fix the highlighted fields.',
    Object.keys(fields).length ? fields : undefined,
  );
}

// Trims strings and turns blank-after-trim into undefined, so "   " counts as an empty field.
function blankToUndefined(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

module.exports = { validate, blankToUndefined };
