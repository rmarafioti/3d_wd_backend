// Entry point for `npm run check:sync`: diffs what must match in the backend and ../3d_wd (the API
// Contract, the guard hook, docs/process.md), and finds backend facts the frontend's docs restate.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FRONTEND_DIR, NOT_FRONTEND_REPO, isFrontendRepo } = require('./frontendRepo');

const BACKEND_DIR = path.resolve(__dirname, '..');

// Each pair: a name for the report, the backend file, the frontend file, and an optional cut that
// takes the part of each file that must match.
const PAIRS = [
  {
    name: 'API Contract',
    backend: 'docs/endpoints.md',
    frontend: 'docs/api.md',
    cut: apiContractSection,
  },
  { name: 'guard hook', backend: '.claude/hooks/guard.js', frontend: '.claude/hooks/guard.js' },
  {
    name: 'guard hook tests',
    backend: '.claude/hooks/guard.test.js',
    frontend: '.claude/hooks/guard.test.js',
  },
  { name: 'shared process', backend: 'docs/process.md', frontend: 'docs/process.md' },
];

// The frontend's own docs, which point to the backend's facts rather than restating them. `skip` lists
// the `## ` sections left out: Current progress is a record, and Features must match the backend's.
const RESTATED_FACT_FILES = [
  { file: 'CLAUDE.md', skip: ['## Current progress', '## Features'] },
  { file: 'docs/flows.md' },
  { file: 'docs/deploy.md' },
  { file: 'docs/scaling.md' },
];

// Backend facts a frontend doc should only point to. Each matches the unquoted part of a line, since
// quoted text is UI copy the frontend shows. A pattern that catches a frontend fact is narrowed.
const RESTATED_FACTS = [
  { label: 'a field limit', pattern: /\bmax [0-9]/ },
  { label: 'an image count', pattern: /\b[0-9]+ to [0-9]+ images\b/ },
  { label: 'a file size', pattern: /\b[0-9]+ ?MB\b/ },
  { label: 'an upload or crop number', pattern: /\b2500\b|\b0\.85\b|\bwithin 1%/ },
  { label: 'the 30-day retention', pattern: /\b30 days\b/ },
  { label: 'a backend timing', pattern: /\b(15 minutes|24 hours)\b/ },
  { label: 'a message or page count', pattern: /\b[0-9]+ (messages|events a page)\b/ },
  { label: 'a cookie attribute', pattern: /SameSite|Domain=\./ },
  { label: 'a database column', pattern: /\b[a-z]+_at\b/ },
  {
    label: 'a backend email or hosting fact',
    pattern: /Reply-To|point-in-time|Hobby workspace|13\.30/,
  },
  { label: 'a backend transaction', pattern: /in one transaction/ },
];

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

// The API Contract section: from its `## API Contract` heading up to, not including, the next line
// that is exactly `---`. Both repos keep their own intro above it, so only this part is compared.
// Null when the heading is missing.
function apiContractSection(markdown) {
  const lines = markdown.split('\n');
  const start = lines.indexOf('## API Contract');
  if (start === -1) return null;
  const end = lines.indexOf('---', start);
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

// Compares the two sides of one pair. A null side is a missing file (or section). The diff comes
// from `git diff --no-index`, which shows an inserted line as one line rather than every line after
// it as changed.
function compareTexts(name, backendText, frontendText) {
  if (backendText === null || frontendText === null) return { status: 'missing' };
  if (backendText === frontendText) return { status: 'identical' };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-sync-'));
  try {
    fs.writeFileSync(path.join(dir, 'backend'), backendText);
    fs.writeFileSync(path.join(dir, 'frontend'), frontendText);
    let diff = '';
    try {
      // Run inside the temp folder, so the headers read a/backend and b/frontend.
      execFileSync('git', ['diff', '--no-index', '--no-color', 'backend', 'frontend'], {
        cwd: dir,
        encoding: 'utf8',
      });
    } catch (err) {
      // git diff exits 1 when the files differ; the diff is on stdout.
      if (err.status !== 1) throw err;
      diff = err.stdout;
    }
    return { status: 'differs', diff: `${name}\n${diff}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Blanks every quoted span, straight or curly, so UI copy the frontend shows is never matched.
function stripQuotes(line) {
  return line.replace(/"[^"]*"|“[^”]*”/g, '""');
}

// Every line of a frontend doc that restates a backend fact: its 1-based line number, the fact's
// label and the line. Lines under a heading in `skip` are left out, up to the next `## ` heading.
function findRestatedFacts(markdown, skip = []) {
  const found = [];
  let isSkipping = false;
  markdown.split('\n').forEach((text, index) => {
    if (text.startsWith('## ')) isSkipping = skip.includes(text.trim());
    if (isSkipping) return;
    const unquoted = stripQuotes(text);
    for (const fact of RESTATED_FACTS) {
      if (fact.pattern.test(unquoted)) found.push({ line: index + 1, label: fact.label, text });
    }
  });
  return found;
}

function readBackendFile(file) {
  const full = path.join(BACKEND_DIR, file);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

// The frontend side is its origin/main, read with `git show` after a fetch, so its working tree
// is never read or touched.
function readFrontendFile(file) {
  try {
    return execFileSync('git', ['-C', FRONTEND_DIR, 'show', `origin/main:${file}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function checkSync() {
  if (!isFrontendRepo()) throw new Error(NOT_FRONTEND_REPO);
  git(FRONTEND_DIR, ['fetch', '--quiet', 'origin', 'main']);
  console.log(`Backend: this working tree. Frontend: ${FRONTEND_DIR} at origin/main.\n`);

  let isClean = true;
  for (const pair of PAIRS) {
    const cut = pair.cut ?? ((text) => text);
    const backendFile = readBackendFile(pair.backend);
    const frontendFile = readFrontendFile(pair.frontend);
    const backendText = backendFile === null ? null : cut(backendFile);
    const frontendText = frontendFile === null ? null : cut(frontendFile);
    const result = compareTexts(pair.name, backendText, frontendText);

    if (result.status === 'identical') {
      console.log(`identical: ${pair.name}`);
      continue;
    }
    isClean = false;
    if (result.status === 'missing') {
      const sides = [
        backendText === null && `backend ${pair.backend}`,
        frontendText === null && `frontend ${pair.frontend}`,
      ].filter(Boolean);
      console.log(`missing: ${pair.name} (${sides.join(', ')})`);
      continue;
    }
    console.log(`differs: ${pair.name} (- backend ${pair.backend}, + frontend ${pair.frontend})`);
    console.log(result.diff);
  }

  for (const { file, skip } of RESTATED_FACT_FILES) {
    const markdown = readFrontendFile(file);
    if (markdown === null) {
      isClean = false;
      console.log(`missing: frontend ${file}`);
      continue;
    }
    const found = findRestatedFacts(markdown, skip);
    if (found.length === 0) {
      console.log(`no restated facts: ${file}`);
      continue;
    }
    isClean = false;
    for (const { line, label, text } of found) {
      console.log(`restated: ${file}:${line} ${label}\n  ${text.trim()}`);
    }
  }
  return isClean;
}

if (require.main === module) {
  try {
    process.exit(checkSync() ? 0 : 1);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { apiContractSection, compareTexts, findRestatedFacts, stripQuotes };
