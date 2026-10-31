// Tests for the guard hook (.claude/hooks/guard.js): every deny and ask rule in CLAUDE.md →
// Version Control, the spellings a deny rule's prefix match would miss, and the everyday commands
// that must pass untouched. One test runs the script itself to check the stdin → stdout wiring.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { checkToolCall } = require('./guard');

function bash(command) {
  return checkToolCall({ tool_name: 'Bash', tool_input: { command } });
}

function decisionOf(command) {
  return bash(command)?.decision ?? 'pass';
}

describe('guard hook', () => {
  const denied = [
    'git push --force origin feat/x',
    'git push origin feat/x --force-with-lease',
    'git push -f origin feat/x',
    'git push -uf origin feat/x',
    'git -C ../3d_wd push -f origin feat/x',
    'git push origin +feat/x',
    'git push origin --delete feat/x',
    'git push origin -d feat/x',
    'git push origin :feat/x',
    'git push --mirror origin',
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin main:production',
    'git push origin abc123:refs/heads/production',
    'cd ../3d_wd && git push origin main',
    'git push origin refs/tags/release-2026-10-31',
    'git push origin release-2026-10-31',
    'git push --tags',
    'git push --follow-tags origin feat/x',
    'git branch -D feat/x',
    'git branch --delete --force feat/x',
    'git branch -df feat/x',
    'git commit --no-verify -m "x"',
    'git commit -n -m "x"',
    'git push --no-verify origin feat/x',
    'git commit -m "fix typo [skip ci]"',
    'cat .env',
    'cat ./.env.local',
    'grep SECRET .env',
    'source .env',
    "node -e \"console.log(require('fs').readFileSync('.env', 'utf8'))\"",
    'wc -l < .env',
    'psql "postgresql://user:pw@dpg-abc.virginia-postgres.render.com/db" -c "select 1"',
    'psql -h dpg-abc.virginia-postgres.render.com -U app db',
    'pg_dump postgresql://user:pw@db.example.com:5432/app',
  ];
  for (const command of denied) {
    it(`denies: ${command}`, () => {
      assert.equal(decisionOf(command), 'deny');
    });
  }

  const asked = [
    'git reset --hard',
    'git reset --hard origin/main',
    'cd x && git reset --hard',
    'git clean -fd',
    'git clean --force',
    'git checkout -- .',
    'git checkout .',
    'git checkout main -- app.js',
    'git restore app.js',
    'git restore --staged --worktree app.js',
    'git switch --discard-changes main',
    'git stash drop',
    'git stash clear',
    'npx prisma migrate reset',
    'npx prisma db push --force-reset',
    'dropdb headless_cms',
    'psql postgresql://postgres:postgres@localhost:5433/headless_cms -c "TRUNCATE post"',
    'psql postgresql://localhost:5433/headless_cms -c "DROP TABLE post"',
    'psql postgresql://localhost:5433/headless_cms -c "DELETE FROM post WHERE id = \'x\'"',
    "psql postgresql://localhost:5433/headless_cms <<'SQL'\nBEGIN;\nDELETE FROM post;\nCOMMIT;\nSQL",
    'npx prisma db execute --stdin <<< "DROP SCHEMA public CASCADE"',
    'docker compose down -v',
    'docker-compose down --volumes',
    'docker volume rm 3d_wd_backend_pgdata',
    'curl -X DELETE https://api.cloudinary.com/v1_1/demo/resources/image/upload',
  ];
  for (const command of asked) {
    it(`asks first: ${command.split('\n')[0]}`, () => {
      assert.equal(decisionOf(command), 'ask');
    });
  }

  const passed = [
    'git status',
    'git push -u origin chore/version-control',
    'git push origin feat/x',
    'git branch -d feat/x',
    'git branch --merged origin/main',
    'git checkout -b feat/x',
    'git checkout main',
    'git restore --staged app.js',
    'git stash',
    'git stash pop',
    'git reset HEAD~1 --soft',
    'git commit -am "docs: never read .env, and no TRUNCATE in psql"',
    'git log --oneline -5',
    "python3 -I - <<'PY'\ns = s.replace('never read `.env`', 'never print `.env`')\nPY",
    "python3 -I - <<'PY'\n# the script loads .env itself\nopen('scripts/release.js').read()\nPY",
    "node -e \"console.log(require('fs').readFileSync('.env.example', 'utf8'))\"",
    'cat .env.example',
    'cp .env.example .env.example.bak',
    'grep -rn "dotenv/config" .',
    'gh pr create --title "x" --body "Denies reading .env and DELETE FROM in psql."',
    'psql postgresql://postgres:postgres@localhost:5433/headless_cms -c "SELECT id FROM post"',
    'psql -h localhost -p 5433 headless_cms',
    'npm test',
    'npm run sweep:uploads',
    'npx prisma migrate dev --name add_x',
    'docker compose down',
    'docker compose up -d',
    'curl -s https://api.cloudinary.com/v1_1/demo/resources/image',
  ];
  for (const command of passed) {
    it(`passes: ${command}`, () => {
      assert.equal(decisionOf(command), 'pass');
    });
  }

  it('denies the Read tool on .env', () => {
    const result = checkToolCall({ tool_name: 'Read', tool_input: { file_path: '/repo/.env' } });

    assert.equal(result.decision, 'deny');
  });

  it('denies the Grep tool on .env.local', () => {
    const result = checkToolCall({ tool_name: 'Grep', tool_input: { path: '/repo/.env.local' } });

    assert.equal(result.decision, 'deny');
  });

  it('lets the Read tool open .env.example', () => {
    const result = checkToolCall({
      tool_name: 'Read',
      tool_input: { file_path: '/repo/.env.example' },
    });

    assert.equal(result, null);
  });

  it('prefers deny when one command breaks both kinds of rule', () => {
    assert.equal(decisionOf('git reset --hard && git push --force origin feat/x'), 'deny');
  });

  it('gives the rule in its reason', () => {
    assert.match(bash('git branch -D feat/x').reason, /git branch -d/);
  });

  it('answers on stdout as a PreToolUse permission decision', () => {
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push -f' } });

    const result = spawnSync(process.execPath, [path.join(__dirname, 'guard.js')], {
      input,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(output.hookEventName, 'PreToolUse');
    assert.equal(output.permissionDecision, 'deny');
  });

  it('prints nothing for a command it leaves alone', () => {
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } });

    const result = spawnSync(process.execPath, [path.join(__dirname, 'guard.js')], {
      input,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('blocks the call when its input is not JSON', () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'guard.js')], {
      input: 'not json',
      encoding: 'utf8',
    });

    assert.equal(result.status, 2);
  });
});
