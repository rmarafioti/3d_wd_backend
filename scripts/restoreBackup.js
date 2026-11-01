// Entry point for `npm run backup:restore`:
//   npm run backup:restore -- --file <dump.enc> --key <private key .pem> --target <database URL>
// It decrypts a backup downloaded from the R2 bucket and restores it into an empty database
// (docs/deploy.md → Restoring a backup). It refuses this environment's own DATABASE_URL and any
// database that already has tables, so it can't overwrite a live database by mistake.
require('dotenv/config');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { Client } = require('pg');
const { decryptBackup } = require('../lib/crypto');

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function tableCount(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
    );
    return rows[0].count;
  } finally {
    await client.end();
  }
}

// Exits with pg_restore's own status; its messages go straight to the terminal.
function pgRestore(dumpPath, databaseUrl) {
  return new Promise((resolve, reject) => {
    const restore = childProcess.spawn(
      'pg_restore',
      ['--no-owner', '--no-acl', `--dbname=${databaseUrl}`, dumpPath],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    restore.on('error', () =>
      reject(new Error('pg_restore could not be started. Is it installed?')),
    );
    restore.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_restore failed (exit code ${code}).`));
    });
  });
}

async function restoreBackup({ file, key, target }) {
  if ((await tableCount(target)) > 0) {
    throw new Error('The target database already has tables. Restore into a new, empty database.');
  }
  const privateKey = fs.readFileSync(key, 'utf8');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '3dwd-restore-'));
  const dumpPath = path.join(tempDir, 'database.dump');
  try {
    // Written in full and checked by GCM before pg_restore reads any of it.
    await decryptBackup(file, privateKey, fs.createWriteStream(dumpPath, { mode: 0o600 }));
    await pgRestore(dumpPath, target);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    key: { type: 'string' },
    target: { type: 'string' },
  },
});
if (!values.file || !values.key || !values.target) {
  fail(
    'Usage: npm run backup:restore -- --file <dump.enc> --key <private key .pem> --target <database URL>',
  );
}
if (values.target === process.env.DATABASE_URL) {
  fail("The target is this environment's own DATABASE_URL. Restore into a new, empty database.");
}

restoreBackup(values)
  .then(() => {
    console.log('Restore complete.');
  })
  .catch((err) => {
    console.error(`Restore failed: ${err.message}`);
    process.exitCode = 1;
  });
