// Entry point for `npm run release`: releases both repos to production, backend first
// (docs/deploy.md → Every deploy after launch). Rich runs it on his Mac once staging looks right;
// CI never does. It releases each repo's origin/main commit, never the local working tree:
//   1. checks both repos' main commits have built on staging, and asks about new migrations
//   2. pushes the backend's main to production, then waits for Render to report it live
//   3. pushes the frontend's main to its production branch, then waits for Vercel
//   4. tags each repo that went live with this run's release tag, an annotated tag holding the
//      release notes, pushed like the production branch (with git, not the gh token)
// It stops before the frontend if the backend's CI or deploy fails, so production keeps running
// the previous version. Release tags are release-YYYY-MM-DD (UTC), -2, -3… for a second release
// that day, the same name in both repos (CLAUDE.md → Releases). Uses `git`, and `gh` (signed in to
// GitHub) to read deploy states; no .env, no database. --dry-run checks and prints every step,
// the tag messages included, without pushing or tagging.
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

// Release tags sort by date, then by their -N suffix as a number (so -10 comes after -9).
function parseReleaseTag(tag) {
  const match = /^release-(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/.exec(tag);
  return match ? { date: match[1], n: Number(match[2] ?? 1) } : null;
}

// This run's tag: release-<UTC date>, or the first free -2, -3… among both repos' tags, so one
// run has one name.
function nextReleaseTag(now, tags) {
  const date = now.toISOString().slice(0, 10);
  const taken = new Set(tags);
  let tag = `release-${date}`;
  for (let n = 2; taken.has(tag); n++) tag = `release-${date}-${n}`;
  return tag;
}

// A repo's newest release tag, or null before its first.
function latestReleaseTag(tags) {
  const releases = tags.map((tag) => ({ tag, ...parseReleaseTag(tag) })).filter((r) => r.date);
  releases.sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
  return releases.at(-1)?.tag ?? null;
}

// The top of a release's notes: what the other repo's production runs (the pairing a rollback
// reads) and, for the backend, its migrations (a backend rollback can't cross one).
// `other` is { name, outcome: 'released' | 'unchanged' | 'stopped', previousTag }.
function releaseNotesHeader({ tag, other, migrations }) {
  const previous = other.previousTag ?? 'untagged';
  const otherLine = {
    released: `${other.name}: released in this run as ${tag}.`,
    unchanged: `${other.name}: unchanged, still ${previous}.`,
    stopped: `${other.name}: its release stopped; production still runs ${previous}.`,
  }[other.outcome];
  if (!migrations) return otherLine;
  const migrationLines = migrations.length
    ? `Migrations:\n${migrations.map((file) => `- ${file}`).join('\n')}`
    : 'Migrations: none.';
  return `${otherLine}\n\n${migrationLines}`;
}

// The PRs a release carries, from the subjects of the merge commits GitHub makes
// ("Merge pull request #48 from rmarafioti/chore/version-control"), oldest first. Two-repo work
// shares a branch name, so the branch shows which PRs in the two repos went out together.
function pullRequestLines(subjects) {
  return subjects
    .map((subject) => /^Merge pull request (#\d+) from [^/\s]+\/(\S+)/.exec(subject))
    .filter(Boolean)
    .map(([, number, branch]) => `- ${number} ${branch}`)
    .reverse();
}

// The annotated tag's message: the tag, the header, then the PRs since the previous release.
function releaseTagMessage({ tag, header, pullRequests }) {
  const prs = pullRequests.length ? pullRequests.join('\n') : '- none';
  return `${tag}\n\n${header}\n\nPull requests:\n${prs}`;
}

// The repo's release tags, fetched from GitHub so a tag made on another machine counts.
function readReleaseTags(dir) {
  git(dir, ['fetch', '--quiet', '--tags', 'origin']);
  return git(dir, ['tag', '--list', 'release-*']).split('\n').filter(Boolean);
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

// Returns { main, migrations, live }: live once Render reports main live in production, false when
// production already had it.
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
    return { main, migrations, live: false };
  }
  pushToProduction(BACKEND_DIR, main);
  if (DRY_RUN) return { main, migrations, live: true };
  console.log('  pushed; waiting for CI and Render (a few minutes)');

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
  return { main, migrations, live: true };
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

// Returns true once Vercel reports the production deploy, false when production already had it.
async function releaseFrontend({ main, production, before }) {
  console.log('Frontend:');
  if (production === main) {
    console.log('  production already has this commit');
    return false;
  }

  pushToProduction(FRONTEND_DIR, main);
  if (DRY_RUN) return true;
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
  return true;
}

// Tags the commit that went live with an annotated tag and pushes it. Production is already live
// by then, so a failure here only prints the commands to run by hand.
function tagRelease({ dir, repo, tag, sha, previousTag, header }) {
  // Everything inside the try: this runs in release()'s finally, so a throw here would hide the
  // error that stopped the release.
  try {
    const range = previousTag ? `${previousTag}..${sha}` : sha;
    const subjects = git(dir, ['log', '--merges', '--first-parent', '--format=%s', range]);
    const pullRequests = pullRequestLines(subjects.split('\n'));
    const message = releaseTagMessage({ tag, header, pullRequests });
    if (DRY_RUN) return console.log(`  [dry run] would tag ${repo} ${short(sha)}:\n${message}`);
    git(dir, ['tag', '--annotate', tag, sha, '--message', message]);
    git(dir, ['push', '--quiet', 'origin', `refs/tags/${tag}`]);
    console.log(`  tagged ${repo} ${short(sha)} as ${tag}`);
  } catch (err) {
    console.error(`  Couldn't tag ${repo}: ${err.message.split('\n')[0]}`);
    console.error(
      `  Production is live. In ${dir}, create the tag if it's missing (git tag --annotate ${tag} ${sha}), then: git push origin refs/tags/${tag}`,
    );
  }
}

// Tags each repo that went live in this run. It runs after a stop too, so a backend that went
// live before the frontend failed is still tagged, with the frontend recorded as stopped.
function tagReleases({ tag, backendTags, frontendTags, backend, frontend }) {
  if (!backend.live && !frontend.live) return;
  const backendPrevious = latestReleaseTag(backendTags);
  const frontendPrevious = latestReleaseTag(frontendTags);
  console.log('Release tags:');
  if (backend.live) {
    tagRelease({
      dir: BACKEND_DIR,
      repo: BACKEND_REPO,
      tag,
      sha: backend.main,
      previousTag: backendPrevious,
      header: releaseNotesHeader({
        tag,
        other: { name: 'Frontend', outcome: frontend.outcome, previousTag: frontendPrevious },
        migrations: backend.migrations,
      }),
    });
  }
  if (frontend.live) {
    tagRelease({
      dir: FRONTEND_DIR,
      repo: FRONTEND_REPO,
      tag,
      sha: frontend.main,
      previousTag: frontendPrevious,
      header: releaseNotesHeader({
        tag,
        other: { name: 'Backend', outcome: backend.outcome, previousTag: backendPrevious },
      }),
    });
  }
}

async function release() {
  if (DRY_RUN) console.log('Dry run: nothing is pushed or tagged.\n');
  // checkFrontend first: it confirms FRONTEND_DIR is the frontend repo before its tags are read.
  const frontendCheck = checkFrontend();
  const backendTags = readReleaseTags(BACKEND_DIR);
  const frontendTags = readReleaseTags(FRONTEND_DIR);
  const tag = nextReleaseTag(new Date(), [...backendTags, ...frontendTags]);
  console.log(`Release tag: ${tag}`);
  // outcome: 'released' once live, 'unchanged' when production already had main, and 'stopped'
  // when a release was due but didn't go live (a stop, a failed deploy, or the backend failing
  // first).
  const backend = { live: false, outcome: 'stopped' };
  const frontend = {
    live: false,
    main: frontendCheck.main,
    outcome: frontendCheck.production === frontendCheck.main ? 'unchanged' : 'stopped',
  };
  try {
    Object.assign(backend, await releaseBackend());
    backend.outcome = backend.live ? 'released' : 'unchanged';
    frontend.live = await releaseFrontend(frontendCheck);
    if (frontend.live) frontend.outcome = 'released';
  } finally {
    tagReleases({ tag, backendTags, frontendTags, backend, frontend });
  }
  console.log(DRY_RUN ? '\nDry run done.' : '\nReleased. Check production.');
}

if (require.main === module) {
  release().catch((err) => {
    console.error(`\n${err instanceof ReleaseStopped ? err.message : err.stack}`);
    process.exit(1);
  });
}

module.exports = {
  nextReleaseTag,
  latestReleaseTag,
  releaseNotesHeader,
  pullRequestLines,
  releaseTagMessage,
};
