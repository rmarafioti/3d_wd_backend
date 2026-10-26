// Tests for the restore script's safety refusals (scripts/restoreBackup.js), run as the real script.
// Both refusals happen before the backup or key is read, so no pg_restore or backup file is needed.
// The test database always has tables (pretest migrates it), so it plays a live database.
require('../testing/setup');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'restoreBackup.js');

// dotenv never overrides a variable already set, so `databaseUrl` is the script's DATABASE_URL.
function runRestore(target, databaseUrl) {
  return spawnSync(
    process.execPath,
    [SCRIPT, '--file', 'missing.dump.enc', '--key', 'missing.pem', '--target', target],
    { encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl } },
  );
}

describe('restoreBackup', () => {
  it("refuses this environment's own DATABASE_URL", () => {
    const result = runRestore(process.env.TEST_DATABASE_URL, process.env.TEST_DATABASE_URL);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /this environment's own DATABASE_URL/);
  });

  it('refuses a database that already has tables', () => {
    const result = runRestore(process.env.TEST_DATABASE_URL, 'postgresql://localhost/other');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /already has tables/);
  });
});
