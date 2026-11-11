// Tests for retrying a gallery write that clashes with a concurrent one (lib/galleryNames.js), the
// paths a request test can't reach reliably.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { retryOnClash } = require('./galleryNames');

// A write that fails with a serialization failure (Prisma's P2034) `clashes` times, then succeeds.
function writeThatClashes(clashes) {
  let calls = 0;
  const write = async () => {
    calls += 1;
    if (calls <= clashes) throw Object.assign(new Error('clash'), { code: 'P2034' });
    return 'saved';
  };
  return { write, calls: () => calls };
}

describe('retryOnClash', () => {
  it('retries a write that clashes and returns its result', async () => {
    const { write, calls } = writeThatClashes(2);

    const result = await retryOnClash(write);

    assert.equal(result, 'saved');
    assert.equal(calls(), 3);
  });

  it('rethrows an error that is not a clash without retrying', async () => {
    let calls = 0;
    const write = async () => {
      calls += 1;
      throw new Error('not a clash');
    };

    await assert.rejects(retryOnClash(write), { message: 'not a clash' });

    assert.equal(calls, 1);
  });

  it('gives up after five clashes and rethrows the last one', async () => {
    const { write, calls } = writeThatClashes(Infinity);

    await assert.rejects(retryOnClash(write), { code: 'P2034' });

    assert.equal(calls(), 5);
  });
});
