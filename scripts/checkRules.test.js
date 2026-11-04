// Tests for the rule checks in scripts/checkRules.js, each on a small piece of source text, so
// nothing here reads the repo. Each rule is shown passing and failing.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  checkEmDash,
  checkNodePrefix,
  checkSecretColumns,
  checkUnsafeRawSql,
  checkServerErrorMessages,
} = require('./checkRules');

const ENDPOINTS_DOC =
  '| 404 | Post not found. |\n| 409 | This account is already linked to [Website Name]. |';

describe('checkEmDash', () => {
  it('flags an em dash in a user-facing string', () => {
    const text = "const a = 1;\nthrow new ServerError(409, 'Taken — try again.');";

    assert.deepEqual(checkEmDash('api/x.js', text), [
      { file: 'api/x.js', line: 2, rule: 'em dash in a user-facing string' },
    ]);
  });

  it('allows an em dash in a comment, whole-line or trailing', () => {
    const text = '// GET /api/x — lists x.\n * a — b\nfoo(); // a — b';

    assert.deepEqual(checkEmDash('api/x.js', text), []);
  });

  it('skips tests and files outside the user-facing folders', () => {
    assert.deepEqual(checkEmDash('api/x.test.js', "'a — b'"), []);
    assert.deepEqual(checkEmDash('scripts/x.js', "'a — b'"), []);
  });
});

describe('checkNodePrefix', () => {
  it('flags a built-in required without node:', () => {
    const [violation] = checkNodePrefix('lib/x.js', "const a = 1;\nconst fs = require('fs');");

    assert.equal(violation.line, 2);
    assert.match(violation.rule, /node:fs/);
  });

  it('allows node: built-ins and packages', () => {
    const text = "require('node:fs');\nrequire('express');\nrequire('./local');";

    assert.deepEqual(checkNodePrefix('lib/x.js', text), []);
  });

  it("skips the guard hook's tests", () => {
    assert.deepEqual(checkNodePrefix('.claude/hooks/guard.test.js', "require('fs')"), []);
  });
});

describe('checkSecretColumns', () => {
  it('flags a secret column outside its files', () => {
    const [violation] = checkSecretColumns(
      'api/siteOwner/index.js',
      'select: { apiKeyHash: true }',
    );

    assert.equal(violation.rule, 'apiKeyHash outside its files');
  });

  it('allows its files, tests and testing/', () => {
    const text = 'webhookSecretEncrypted';

    assert.deepEqual(checkSecretColumns('services/revalidate.js', text), []);
    assert.deepEqual(checkSecretColumns('api/admin/index.test.js', text), []);
    assert.deepEqual(checkSecretColumns('testing/helpers.js', text), []);
  });
});

describe('checkUnsafeRawSql', () => {
  it('flags $queryRawUnsafe outside testing/', () => {
    const [violation] = checkUnsafeRawSql('api/admin/index.js', 'prisma.$queryRawUnsafe(sql)');

    assert.equal(violation.rule, '$queryRawUnsafe outside testing/');
  });

  it('allows the test helpers', () => {
    assert.deepEqual(checkUnsafeRawSql('testing/helpers.js', 'prisma.$executeRawUnsafe(x)'), []);
  });
});

describe('checkServerErrorMessages', () => {
  it('passes a literal message that is in the doc', () => {
    const text = "throw new ServerError(404, 'Post not found.');";

    assert.deepEqual(checkServerErrorMessages('api/x.js', text, ENDPOINTS_DOC), []);
  });

  it('flags a message missing from the doc', () => {
    const text = "throw new ServerError(404, 'Post is gone.');";

    assert.deepEqual(checkServerErrorMessages('api/x.js', text, ENDPOINTS_DOC), [
      { file: 'api/x.js', line: 1, rule: 'message not in docs/endpoints.md: Post is gone.' },
    ]);
  });

  it('resolves a const declared in the same file, across lines', () => {
    const text = "const GONE = 'Post is gone.';\n\nthrow new ServerError(\n  404,\n  GONE,\n);";

    const [violation] = checkServerErrorMessages('api/x.js', text, ENDPOINTS_DOC);

    assert.equal(violation.line, 3);
    assert.match(violation.rule, /Post is gone\./);
  });

  it("checks a template literal by its static parts, the doc's placeholder aside", () => {
    const text =
      'const m = `This account is already linked to ${name}.`;\nnew ServerError(409, m);';

    assert.deepEqual(checkServerErrorMessages('api/x.js', text, ENDPOINTS_DOC), []);
  });

  it('counts braces inside ${…}, so an object literal there does not end it early', () => {
    const text = 'new ServerError(409, `This account is already linked to ${f({ a: 1 })}.`);';

    assert.deepEqual(checkServerErrorMessages('api/x.js', text, ENDPOINTS_DOC), []);
  });

  it('flags a message it cannot read', () => {
    const text = 'throw new ServerError(404, messages.notFound);';

    const [violation] = checkServerErrorMessages('api/x.js', text, ENDPOINTS_DOC);

    assert.equal(violation.rule, 'ServerError message is not a literal or a const');
  });
});
