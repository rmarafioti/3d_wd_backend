// Tests for lib/errorLog.js: what a log line may say about an unexpected error.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { errorSummary, describeError } = require('./errorLog');

describe('errorSummary', () => {
  it("gives a Prisma error's name and code, never its message", () => {
    const err = new Prisma.PrismaClientKnownRequestError('email sam@example.com is taken', {
      code: 'P2002',
      clientVersion: '7',
    });

    assert.equal(errorSummary(err), 'PrismaClientKnownRequestError P2002');
  });

  it('gives the name alone for an error with no code', () => {
    assert.equal(errorSummary(new TypeError('fetch failed')), 'TypeError');
  });
});

describe('describeError', () => {
  it('gives the summary and the stack frames, without the message', () => {
    const err = new Prisma.PrismaClientValidationError('where: { email: "sam@example.com" }', {
      clientVersion: '7',
    });

    const description = describeError(err);

    const [first, ...frames] = description.split('\n');
    assert.equal(first, 'PrismaClientValidationError');
    assert.ok(frames.length > 0);
    assert.ok(frames.every((line) => /^\s+at /.test(line)));
    assert.ok(!description.includes('sam@example.com'));
  });

  it('leaves out every line of a message that runs over several lines', () => {
    const err = new Error(
      'Invalid query:\n  content: "My private post"\n  email: "sam@example.com"',
    );

    const description = describeError(err);

    assert.ok(!description.includes('My private post'));
    assert.ok(!description.includes('sam@example.com'));
  });
});
