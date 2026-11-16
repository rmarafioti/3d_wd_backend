// Tests for lib/resend.js's failureReason: what a failed email's log line may say about the error.
// The Resend call itself is tested through services/requestEmail.test.js and inquiryEmail.test.js.
require('../testing/setup');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { failureReason } = require('./resend');

describe('failureReason', () => {
  it("gives a Prisma error's name only, never its message's query values", () => {
    const err = new Prisma.PrismaClientValidationError('where: { email: "sam@example.com" }', {
      clientVersion: '7',
    });

    assert.equal(failureReason(err), 'PrismaClientValidationError');
  });

  it("keeps a fetch error's name and message", () => {
    assert.equal(failureReason(new TypeError('fetch failed')), 'TypeError: fetch failed');
  });
});
