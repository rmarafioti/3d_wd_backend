// Tests for website URL normalization and the www. variants used by the duplicate check
// (lib/normalizeUrl.js).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUrl, urlVariants } = require('./normalizeUrl');

describe('normalizeUrl', () => {
  const cases = [
    ['https://www.SteviTheDog.COM', 'https://www.stevithedog.com'],
    ['https://steviethedog.com/', 'https://steviethedog.com'],
    ['https://steviethedog.com///', 'https://steviethedog.com'],
    ['https://steviethedog.com/blog/', 'https://steviethedog.com/blog'],
    ['https://steviethedog.com/Blog', 'https://steviethedog.com/Blog'],
    ['https://steviethedog.com/?ref=ad#top', 'https://steviethedog.com'],
    ['https://steviethedog.com:8443/', 'https://steviethedog.com:8443'],
  ];

  for (const [input, expected] of cases) {
    it(`turns ${input} into ${expected}`, () => {
      assert.equal(normalizeUrl(input), expected);
    });
  }
});

describe('urlVariants', () => {
  it('adds a leading www. to a bare domain', () => {
    assert.deepEqual(urlVariants('https://steviethedog.com'), [
      'https://steviethedog.com',
      'https://www.steviethedog.com',
    ]);
  });

  it('removes a leading www.', () => {
    assert.deepEqual(urlVariants('https://www.steviethedog.com'), [
      'https://www.steviethedog.com',
      'https://steviethedog.com',
    ]);
  });

  it('keeps the path on both variants', () => {
    assert.deepEqual(urlVariants('https://www.steviethedog.com/blog'), [
      'https://www.steviethedog.com/blog',
      'https://steviethedog.com/blog',
    ]);
  });

  it('treats another subdomain as part of the host, not as www.', () => {
    assert.deepEqual(urlVariants('https://blog.steviethedog.com'), [
      'https://blog.steviethedog.com',
      'https://www.blog.steviethedog.com',
    ]);
  });
});
