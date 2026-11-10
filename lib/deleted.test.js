// Unit test for the bulk runner in lib/deleted.js: an error other than a 404 fails the whole
// request, which a request test can't force without mocking the database.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runPerItem } = require('./deleted');

const ID = '019a0000-0000-7000-8000-000000000000';

describe('runPerItem', () => {
  it('fails the whole request on any other error', async () => {
    const error = new Error('connection lost');
    const handlers = {
      thread: async () => {
        throw error;
      },
    };

    await assert.rejects(runPerItem([{ type: 'thread', id: ID }], handlers), error);
  });
});
