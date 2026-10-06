// The single error handler. Every error leaves the server as { error: { message, fields? } }.
// Express 5 forwards rejected async handlers here automatically, so routes just throw.
const ServerError = require('./serverError');

const GENERIC_MESSAGE = 'Something went wrong, please try again.';

// Express recognises an error handler by its four arguments, so `next` must stay in the signature.
function errorHandler(err, req, res, next) {
  if (err instanceof ServerError) {
    const error = { message: err.message };
    if (err.fields) error.fields = err.fields;
    return res.status(err.status).json({ error });
  }

  // Malformed JSON body rejected by express.json().
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Invalid request body.' } });
  }

  // Unexpected: log the error itself (never request headers or cookies) and hide the details.
  console.error(err);
  return res.status(500).json({ error: { message: GENERIC_MESSAGE } });
}

module.exports = { errorHandler, ServerError };
