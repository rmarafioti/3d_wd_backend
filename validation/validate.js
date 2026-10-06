// Shared validation helper. Every route runs its zod schema through validate(), so a failed
// check always leaves the server as the same 400 envelope:
// { error: { message: 'Please fix the highlighted fields.', fields: { fieldName: 'message' } } }
// Field keys are the full path to the input, joined with dots: top-level fields keep their own
// name ("email"), nested ones point at the exact input ("images.0.src", "links.2.url").
const { ServerError } = require('../errors');

// Returns the parsed (trimmed, transformed) data, or throws the 400 with one message per field.
function validate(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    // Issues without a path (the body itself isn't an object) only get the general message.
    if (key && !(key in fields)) fields[key] = issue.message;
  }
  throw new ServerError(
    400,
    'Please fix the highlighted fields.',
    Object.keys(fields).length ? fields : undefined,
  );
}

// Trims strings and turns blank-after-trim (and null) into undefined, so "   " and null both
// count as an empty field.
function blankToUndefined(value) {
  if (value === null) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

module.exports = { validate, blankToUndefined };
