// Tests for the cross-repo comparison in scripts/checkSync.js. Only the pure helpers are tested:
// nothing here reads the frontend repo or fetches.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { apiContractSection, compareTexts } = require('./checkSync');

describe('apiContractSection', () => {
  it('takes the section from its heading up to the first --- line', () => {
    const markdown = '# Endpoints\n\nIntro.\n\n## API Contract\n\nShapes.\n\n---\n\n## Middleware';

    assert.equal(apiContractSection(markdown), '## API Contract\n\nShapes.\n');
  });

  it('runs to the end of the file when no --- follows', () => {
    assert.equal(apiContractSection('## API Contract\n\nShapes.'), '## API Contract\n\nShapes.');
  });

  it('returns null when the heading is missing', () => {
    assert.equal(apiContractSection('# API\n\nNo contract here.'), null);
  });
});

describe('compareTexts', () => {
  it('reports identical text as identical', () => {
    assert.deepEqual(compareTexts('API Contract', 'a\nb\n', 'a\nb\n'), { status: 'identical' });
  });

  it('reports a changed line as differs, with that line in the diff', () => {
    const result = compareTexts('API Contract', 'a\nold line\nc\n', 'a\nnew line\nc\n');

    assert.equal(result.status, 'differs');
    assert.match(result.diff, /^-old line$/m);
    assert.match(result.diff, /^\+new line$/m);
  });

  it('reports a missing side as missing', () => {
    assert.deepEqual(compareTexts('guard hook', 'a\n', null), { status: 'missing' });
    assert.deepEqual(compareTexts('guard hook', null, 'a\n'), { status: 'missing' });
  });
});
