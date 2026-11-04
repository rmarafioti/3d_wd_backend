// Custom error class for expected failures (400, 401, 403, 404, 409): routes and middleware throw
// it, and the handler in errors/index.js turns it into the error envelope.
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
