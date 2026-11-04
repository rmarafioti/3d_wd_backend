// Entry point for `npm run check:rules`: the Code Style and Anti-Pattern rules a search can prove,
// checked over every tracked .js file, so CI enforces them instead of a reviewer reading for them
// (CLAUDE.md → Code Review → Checklist; /code-sweep runs it). The rules:
//   - no em dash in a user-facing string (only comments may hold one)
//   - Node built-ins required with the node: prefix
//   - apiKeyHash / webhookSecretEncrypted only in the files that need them
//   - no $queryRawUnsafe / $executeRawUnsafe outside the test helpers
//   - every ServerError message appears word for word in docs/endpoints.md
// Read-only. Prints each violation as file:line and exits 1 when there is any.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { builtinModules } = require('node:module');
const path = require('node:path');

const REPO_DIR = path.resolve(__dirname, '..');

// Folders whose strings can reach a user (error messages, validation messages).
const USER_FACING = ['api/', 'middleware/', 'errors/', 'validation/', 'lib/', 'app.js'];

// The only files that may name the secret columns: the two that read them, and the admin router,
// which writes them when a website is created (and must never select them).
const SECRET_FILES = [
  'middleware/requireApiKey.js',
  'services/revalidate.js',
  'api/admin/index.js',
];

// The guard hook's tests hold, as strings, commands the hook must refuse (some with a bare
// require('fs')), and the file stays identical to the frontend's, so the require rule skips it.
const REQUIRE_RULE_SKIPS = ['.claude/hooks/guard.test.js'];

const SECRET_COLUMN = /\b(apiKeyHash|webhookSecretEncrypted)\b/;
const UNSAFE_RAW_SQL = /\$(queryRawUnsafe|executeRawUnsafe)\b/;
const REQUIRE_CALL = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

function isTestFile(file) {
  return file.endsWith('.test.js') || file.startsWith('testing/');
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

// A line with its comment removed: a whole-line comment (// or a block comment's *) is dropped,
// and a trailing ` // …` is cut. Strings that contain " //" are rare enough to accept the miss.
function codePart(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';
  const trailing = line.indexOf(' //');
  return trailing === -1 ? line : line.slice(0, trailing);
}

function checkEmDash(file, text) {
  if (isTestFile(file) || !USER_FACING.some((prefix) => file.startsWith(prefix))) return [];
  return text
    .split('\n')
    .map((line, i) => ({ line, number: i + 1 }))
    .filter(({ line }) => codePart(line).includes('—'))
    .map(({ number }) => ({ file, line: number, rule: 'em dash in a user-facing string' }));
}

function checkNodePrefix(file, text) {
  if (REQUIRE_RULE_SKIPS.includes(file)) return [];
  return [...text.matchAll(REQUIRE_CALL)]
    .filter((match) => builtinModules.includes(match[1]) && !match[1].startsWith('node:'))
    .map((match) => ({
      file,
      line: lineAt(text, match.index),
      rule: `require('node:${match[1]}'), not require('${match[1]}')`,
    }));
}

function checkSecretColumns(file, text) {
  if (isTestFile(file) || SECRET_FILES.includes(file)) return [];
  const match = SECRET_COLUMN.exec(text);
  if (!match) return [];
  return [{ file, line: lineAt(text, match.index), rule: `${match[1]} outside its files` }];
}

function checkUnsafeRawSql(file, text) {
  if (file.startsWith('testing/')) return [];
  const match = UNSAFE_RAW_SQL.exec(text);
  if (!match) return [];
  return [{ file, line: lineAt(text, match.index), rule: `$${match[1]} outside testing/` }];
}

// The index just past the `}` that closes a template's ${…}, given the index just inside it.
// Braces are counted, so an object literal or a nested ${…} inside doesn't end it early.
function skipInterpolation(text, start) {
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') depth -= 1;
    i += 1;
  }
  return i;
}

// Reads the string literal starting at text[start] ('…', "…" or `…`). Returns its static parts
// (a template literal's text between ${…}) and where it ends, or null when no literal starts there.
function readStringLiteral(text, start) {
  const quote = text[start];
  if (!["'", '"', '`'].includes(quote)) return null;
  const parts = [];
  let current = '';
  let i = start + 1;
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') {
      current += text[i + 1];
      i += 2;
    } else if (quote === '`' && text.startsWith('${', i)) {
      parts.push(current);
      current = '';
      i = skipInterpolation(text, i + 2);
    } else {
      current += text[i];
      i += 1;
    }
  }
  parts.push(current);
  return { parts, end: i + 1 };
}

// The message argument of one `new ServerError(status, message…)`: its static parts, from a
// literal written in place or from the const it names in the same file. Null when neither.
function serverErrorMessage(text, argsStart) {
  const afterStatus = /^\s*\d+\s*,\s*/.exec(text.slice(argsStart));
  if (!afterStatus) return null;
  const start = argsStart + afterStatus[0].length;
  const literal = readStringLiteral(text, start);
  if (literal) return literal.parts;

  const name = /^[A-Za-z_$][\w$]*/.exec(text.slice(start));
  if (!name) return null;
  const declaration = new RegExp(`\\bconst\\s+${name[0]}\\s*=\\s*`).exec(text);
  if (!declaration) return null;
  const declared = readStringLiteral(text, declaration.index + declaration[0].length);
  return declared ? declared.parts : null;
}

function checkServerErrorMessages(file, text, endpointsDoc) {
  if (isTestFile(file) || file === 'errors/serverError.js') return [];
  return [...text.matchAll(/new ServerError\(/g)].flatMap((match) => {
    const line = lineAt(text, match.index);
    const parts = serverErrorMessage(text, match.index + match[0].length);
    if (!parts) return [{ file, line, rule: 'ServerError message is not a literal or a const' }];
    const missing = parts.map((part) => part.trim()).filter((p) => p && !endpointsDoc.includes(p));
    return missing.map((part) => ({
      file,
      line,
      rule: `message not in docs/endpoints.md: ${part}`,
    }));
  });
}

function checkFile(file, text, endpointsDoc) {
  return [
    ...checkEmDash(file, text),
    ...checkNodePrefix(file, text),
    ...checkSecretColumns(file, text),
    ...checkUnsafeRawSql(file, text),
    ...checkServerErrorMessages(file, text, endpointsDoc),
  ];
}

function main() {
  const files = execFileSync('git', ['-C', REPO_DIR, 'ls-files', '*.js'], { encoding: 'utf8' })
    .split('\n')
    .filter((file) => file && !file.startsWith('prisma/migrations/'));
  const endpointsDoc = fs.readFileSync(path.join(REPO_DIR, 'docs/endpoints.md'), 'utf8');

  const violations = files.flatMap((file) =>
    checkFile(file, fs.readFileSync(path.join(REPO_DIR, file), 'utf8'), endpointsDoc),
  );

  for (const v of violations) console.log(`${v.file}:${v.line}  ${v.rule}`);
  console.log(
    violations.length === 0
      ? `check:rules: ${files.length} files, every rule holds.`
      : `check:rules: ${violations.length} violation(s).`,
  );
  if (violations.length > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  checkEmDash,
  checkNodePrefix,
  checkSecretColumns,
  checkUnsafeRawSql,
  checkServerErrorMessages,
};
