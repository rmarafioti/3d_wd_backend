// Custom error class for expected failures (401, 403, 404, 409, 400...).
// Routes and middleware throw it; the error handler in errors/index.js turns it into the
// { error: { message, fields? } } envelope with the matching status code.
class ServerError extends Error {
  /**
   * @param {number} status  HTTP status code to respond with
   * @param {string} message message shown to the user (see the API contract)
   * @param {Record<string, string>} [fields] per-field messages, only for 400 validation errors
   */
  constructor(status, message, fields) {
    super(message);
    this.name = 'ServerError';
    this.status = status;
    this.fields = fields;
  }
}

module.exports = ServerError;
