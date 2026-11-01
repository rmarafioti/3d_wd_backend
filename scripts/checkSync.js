// Entry point for `npm run check:sync`: compares what must be identical in the backend and the
// frontend (CLAUDE.md → Documentation Sync, the identical tier) and prints any difference. /doc-sync
// runs it first, so each sync starts from the facts. Compared:
//   - the API Contract section of docs/endpoints.md against the frontend's docs/api.md
//   - .claude/hooks/guard.js and guard.test.js against the frontend's copies
// The backend side is this working tree; the frontend side is its origin/main, read with
// `git show` after a fetch, so the frontend's working tree is never read or touched. Read-only:
// it edits nothing in either repo. Exits 1 when anything differs or is missing.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BACKEND_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.resolve(process.env.FRONTEND_DIR ?? path.join(BACKEND_DIR, '../3d_wd'));

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

function readBackendFile(file) {
  const full = path.join(BACKEND_DIR, file);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

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
  const origin = git(FRONTEND_DIR, ['remote', 'get-url', 'origin']).trim();
  if (!/[:/]rmarafioti\/3d_wd(\.git)?$/.test(origin)) {
    throw new Error(`${FRONTEND_DIR} isn't the rmarafioti/3d_wd repo. Set FRONTEND_DIR.`);
  }
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

module.exports = { apiContractSection, compareTexts };
