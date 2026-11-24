// Tests for the single error handler (errors/index.js): the generic 500, and what its log line may
// say about the error.
require('../testing/setup');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const prisma = require('../prisma');
const { errorHandler } = require('./index');
const { disconnect } = require('../testing/helpers');

after(disconnect);

const GENERIC_500 = { error: { message: 'Something went wrong, please try again.' } };

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
// the app's own routes without mocking our code, so these use the handler directly or a test route.
describe('errorHandler', () => {
  it('hides an unexpected error behind the generic 500 and logs it without its message', (t) => {
    const errorLog = t.mock.method(console, 'error', () => {});
    const err = new Error('connection refused');
    const res = stubResponse();

    errorHandler(err, {}, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, GENERIC_500);
    const [logged] = errorLog.mock.calls[0].arguments;
    assert.ok(logged.startsWith('Error\n'));
    assert.ok(!logged.includes('connection refused'));
  });

  it('logs a Prisma error from a real query without the email address its message quotes', async (t) => {
    const errorLog = t.mock.method(console, 'error', () => {});
    const app = express();
    app.get('/boom', async () => {
      // An unknown field makes Prisma reject the query with a message that quotes its values.
      await prisma.account.findFirst({ where: { email: 'sam@example.com', unknownField: 'x' } });
    });
    app.use(errorHandler);

    const res = await request(app).get('/boom');

    assert.equal(res.status, 500);
    assert.deepEqual(res.body, GENERIC_500);
    const [logged] = errorLog.mock.calls[0].arguments;
    assert.ok(logged.startsWith('PrismaClientValidationError'));
    assert.ok(!logged.includes('sam@example.com'));
  });
});
