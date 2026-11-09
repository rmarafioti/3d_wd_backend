// Unit tests for the bulk runner in lib/deleted.js: which errors fail one item and which fail the
// whole request, which a request test can't force without mocking the database.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ServerError } = require('../errors');
const { runPerItem } = require('./deleted');

const ID = '019a0000-0000-7000-8000-000000000000';

describe('runPerItem', () => {
  it('reports an item whose handler throws a 404 in failed, and runs the rest', async () => {
    const handled = [];
    const handlers = {
      update: async () => {
        throw new ServerError(404, 'Update not found.');
      },
      thread: async (id) => {
        handled.push(id);
      },
    };

    const result = await runPerItem(
      [
        { type: 'update', id: ID },
        { type: 'thread', id: ID },
      ],
      handlers,
    );

    assert.deepEqual(result, {
      done: [{ type: 'thread', id: ID }],
      failed: [{ type: 'update', id: ID, message: 'Update not found.' }],
    });
    assert.deepEqual(handled, [ID]);
  });

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
