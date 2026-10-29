// Entry point for `npm run release`: releases both repos to production, backend first
// (docs/deploy.md → Every deploy after launch). Rich runs it on his Mac once staging looks right;
// CI never does. It releases each repo's origin/main commit, never the local working tree:
//   1. checks both repos' main commits have built on staging, and asks about new migrations
//   2. pushes the backend's main to production, then waits for Render to report it live
//   3. pushes the frontend's main to its production branch, then waits for Vercel
// It stops before the frontend if the backend's CI or deploy fails, so production keeps running
// the previous version. Uses `git` and `gh` (signed in to GitHub); no .env, no database.
// --dry-run checks and prints every step without pushing.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline/promises');

const BACKEND_REPO = 'rmarafioti/3d_wd_backend';
const FRONTEND_REPO = 'rmarafioti/3d_wd';
const BACKEND_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.resolve(process.env.FRONTEND_DIR ?? path.join(BACKEND_DIR, '../3d_wd'));
const STAGING_SERVICE = '3dwd-api-staging';
const PRODUCTION_SERVICE = '3dwd-api-production';
const POLL_MS = 15 * 1000;
const TIMEOUT_MS = 20 * 60 * 1000;
const DRY_RUN = process.argv.includes('--dry-run');

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

function gh(apiPath) {
  return JSON.parse(execFileSync('gh', ['api', apiPath], { encoding: 'utf8' }));
}

function short(sha) {
  return sha.slice(0, 7);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A release stops with a message, never a stack trace.
class ReleaseStopped extends Error {}

// Fetches the repo and returns its origin/main and origin/production commits.
function readBranches(dir) {
  git(dir, ['fetch', '--quiet', 'origin']);
  return {
    main: git(dir, ['rev-parse', 'origin/main']),
    production: git(dir, ['rev-parse', 'origin/production']),
  };
}

// The newest state Render reported to GitHub for `service`'s deploy of `sha` (Render creates one
// GitHub Deployment per deploy, its environment ending in the service name), or null if none yet.
function findRenderDeployState(sha, service) {
  const deployments = gh(`repos/${BACKEND_REPO}/deployments?sha=${sha}&per_page=100`);
  const deployment = deployments.find((d) => d.environment.endsWith(service));
  if (!deployment) return null;
  const [latest] = gh(`repos/${BACKEND_REPO}/deployments/${deployment.id}/statuses?per_page=1`);
  return latest ? { state: latest.state, url: latest.environment_url } : null;
}

// True when a CI `check` run on the commit has finished with anything but success.
function hasFailedCheck(sha) {
  const { check_runs: runs } = gh(
    `repos/${BACKEND_REPO}/commits/${sha}/check-runs?check_name=check`,
  );
  return runs.some((run) => run.status === 'completed' && run.conclusion !== 'success');
}

// Vercel posts a commit status per deployment (context "Vercel"), each with its own dashboard URL.
// Returns the newest state of each deployment on the commit, keyed by that URL.
function readVercelDeploys(sha) {
  const statuses = gh(`repos/${FRONTEND_REPO}/commits/${sha}/statuses?per_page=100`);
  const deploys = new Map();
  for (const status of statuses) {
    // Newest first, so the first status seen for a URL is its current state.
    if (status.context === 'Vercel' && !deploys.has(status.target_url)) {
      deploys.set(status.target_url, status.state);
    }
  }
  return deploys;
}

// Polls `check` until it returns a value, or throws ReleaseStopped after the timeout.
async function waitFor(what, check) {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const result = check();
    if (result) return result;
    if (Date.now() > deadline) throw new ReleaseStopped(`Timed out waiting for ${what}.`);
    await sleep(POLL_MS);
  }
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} (y/N) `);
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

// Pushes `sha` to the repo's production branch. The branch is protected against force pushes, so
// this only ever fast-forwards it to main.
function pushToProduction(dir, sha) {
  if (DRY_RUN) return console.log(`  [dry run] would push ${short(sha)} to production`);
  git(dir, ['push', '--quiet', 'origin', `${sha}:refs/heads/production`]);
}

async function releaseBackend() {
  const { main, production } = readBranches(BACKEND_DIR);
  console.log(`Backend: main is ${short(main)}, production is ${short(production)}.`);

  const staging = findRenderDeployState(main, STAGING_SERVICE);
  if (staging?.state !== 'success') {
    throw new ReleaseStopped(
      `main (${short(main)}) hasn't deployed to staging yet. Check staging first.`,
    );
  }
  console.log('  staging runs this commit');

  const migrations = git(BACKEND_DIR, [
    'diff',
    '--name-only',
    '--diff-filter=A',
    `${production}..${main}`,
    '--',
    'prisma/migrations',
  ])
    .split('\n')
    .filter(Boolean);
  if (migrations.length) {
    console.log(`  new migrations:\n${migrations.map((file) => `    ${file}`).join('\n')}`);
    const goOn = await confirm(
      '  If any of these drops or rewrites data, take a backup first (Trigger Run on 3dwd-backup-database). Continue?',
    );
    if (!goOn) throw new ReleaseStopped('Stopped before releasing. Nothing was pushed.');
  }

  if (production === main) {
    console.log('  production already has this commit');
  } else {
    pushToProduction(BACKEND_DIR, main);
    if (DRY_RUN) return;
    console.log('  pushed; waiting for CI and Render (a few minutes)');
  }

  const deploy = await waitFor('the Render production deploy', () => {
    if (hasFailedCheck(main))
      throw new ReleaseStopped('CI failed on production. Nothing was deployed.');
    const found = findRenderDeployState(main, PRODUCTION_SERVICE);
    if (found?.state === 'failure' || found?.state === 'error') {
      throw new ReleaseStopped(
        `Render's production deploy failed (${found.state}). Check the Render dashboard; production keeps the previous version.`,
      );
    }
    return found?.state === 'success' ? found : null;
  });
  console.log(`  live: ${deploy.url}`);
}

// Checked before anything is pushed: the frontend's main commit must already have built on Vercel
// (its staging build) with nothing still building, so a broken frontend never follows a released
// backend, and the deploy the release push starts is the only new one to wait for.
function checkFrontend() {
  const origin = git(FRONTEND_DIR, ['remote', 'get-url', 'origin']);
  if (!/[:/]rmarafioti\/3d_wd(\.git)?$/.test(origin)) {
    throw new ReleaseStopped(`${FRONTEND_DIR} isn't the ${FRONTEND_REPO} repo. Set FRONTEND_DIR.`);
  }
  const { main, production } = readBranches(FRONTEND_DIR);
  console.log(`Frontend: main is ${short(main)}, production is ${short(production)}.`);
  if (production === main) return { main, production, before: null };

  const before = readVercelDeploys(main);
  const states = [...before.values()];
  if (!states.includes('success') || states.includes('pending')) {
    throw new ReleaseStopped(
      `The frontend's main (${short(main)}) hasn't finished a Vercel build yet. Check staging first.`,
    );
  }
  console.log('  Vercel has built this commit');
  return { main, production, before };
}

async function releaseFrontend({ main, production, before }) {
  console.log('Frontend:');
  if (production === main) return console.log('  production already has this commit');

  pushToProduction(FRONTEND_DIR, main);
  if (DRY_RUN) return;
  console.log('  pushed; waiting for Vercel');

  // The production deploy is the Vercel deploy on this commit that wasn't there before the push.
  const state = await waitFor('the Vercel production deploy', () => {
    const fresh = [...readVercelDeploys(main)].filter(([url]) => !before.has(url));
    const done = fresh.find(([, s]) => s !== 'pending');
    return done ? done[1] : null;
  });
  if (state !== 'success') {
    throw new ReleaseStopped(
      `Vercel's production deploy failed (${state}). Check the Vercel dashboard.`,
    );
  }
  console.log('  live: https://3dwebdev.com');
}

async function release() {
  if (DRY_RUN) console.log('Dry run: nothing is pushed.\n');
  const frontend = checkFrontend();
  await releaseBackend();
  await releaseFrontend(frontend);
  console.log(DRY_RUN ? '\nDry run done.' : '\nReleased. Check production.');
}

release().catch((err) => {
  console.error(`\n${err instanceof ReleaseStopped ? err.message : err.stack}`);
  process.exit(1);
});
