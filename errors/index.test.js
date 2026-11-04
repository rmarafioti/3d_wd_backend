// Tests for the single error handler (errors/index.js), called directly with a stub response.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('./index');

// The smallest response object the handler uses: status() then json().
function stubResponse() {
  return {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

// Expected errors are covered by every request test. An unexpected one can't be triggered through
// a real request without mocking our own code, so only the generic 500 is tested here.
describe('errorHandler', () => {
  it('hides an unexpected error behind the generic 500 and logs it', (t) => {
    const errorLog = t.mock.method(console, 'error', () => {});
    const err = new Error('connection refused');
    const res = stubResponse();

    errorHandler(err, {}, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: { message: 'Something went wrong, please try again.' } });
    assert.equal(errorLog.mock.calls[0].arguments[0], err);
  });
});
