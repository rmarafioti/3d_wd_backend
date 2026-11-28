// Tests for the cross-repo checks in scripts/checkSync.js: only the pure helpers, so nothing here
// reads the frontend repo or fetches.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  apiContractSection,
  compareTexts,
  findRestatedFacts,
  pickFrontendRef,
  stripQuotes,
} = require('./checkSync');

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

describe('stripQuotes', () => {
  it('blanks straight and curly quoted spans and keeps the rest', () => {
    assert.equal(stripQuotes('Shows "Max 5 MB" and “30 days left” here.'), 'Shows "" and "" here.');
  });
});

describe('findRestatedFacts', () => {
  it('reports a restated backend limit with its line number and label', () => {
    const markdown = '# Flows\n\nThe post name is required, max 100.';

    assert.deepEqual(findRestatedFacts(markdown), [
      { line: 3, label: 'a field limit', text: 'The post name is required, max 100.' },
    ]);
  });

  it('ignores a backend fact inside quoted UI copy', () => {
    const markdown = 'The dialog says "Deleted posts stay here for 30 days."';

    assert.deepEqual(findRestatedFacts(markdown), []);
  });

  it('leaves out a skipped section up to the next ## heading', () => {
    const markdown = [
      '## Features',
      '1. Galleries of up to 30 images, restorable for 30 days.',
      '## Flows',
      'Deleted mail stays for 30 days.',
    ].join('\n');

    const found = findRestatedFacts(markdown, ['## Features']);

    assert.deepEqual(
      found.map(({ line, label }) => ({ line, label })),
      [{ line: 4, label: 'the 30-day retention' }],
    );
  });

  it("reports the crop ratio's 1% but not a frontend percentage", () => {
    const markdown = [
      'Text is sized from `html`, at 125%, and fades in at 40% of the screen.',
      'Each mobileCrop must be within 1% of the first one.',
    ].join('\n');

    const found = findRestatedFacts(markdown);

    assert.deepEqual(
      found.map(({ line, label }) => ({ line, label })),
      [{ line: 2, label: 'an upload or crop number' }],
    );
  });

  it('reports nothing for a doc that points to the contract', () => {
    const markdown = 'Limits are in `docs/api.md` → Validation rules.';

    assert.deepEqual(findRestatedFacts(markdown), []);
  });
});

describe('pickFrontendRef', () => {
  it('reads the frontend main from main', () => {
    assert.equal(pickFrontendRef('main', false), 'origin/main');
  });

  it("reads the frontend's branch of the same name when it has one", () => {
    assert.equal(pickFrontendRef('feat/x', true), 'origin/feat/x');
  });

  it('reads the frontend main when it has no branch of that name', () => {
    assert.equal(pickFrontendRef('feat/x', false), 'origin/main');
  });
});
