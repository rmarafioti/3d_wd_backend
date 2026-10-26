// The database backup (docs/deploy.md → Railway services), run by `npm run backup:database`.
// pg_dump writes the whole database in its compressed custom format, the dump is encrypted with
// the backup public key (lib/crypto.js) and uploaded to the R2 bucket (lib/r2.js) under backups/.
// Every object key is timestamped, so a run never overwrites an earlier backup.
// The dump is held in memory: it is a few MB today. Move to a multipart upload before it nears
// a few hundred MB.
const childProcess = require('child_process');
const { Writable } = require('stream');
const { pipeline } = require('stream/promises');
const { backupPublicKey, createBackupEncryptor } = require('../lib/crypto');
const { putObject } = require('../lib/r2');

// No owner or privileges, so the dump restores into any database whatever its roles.
const PG_DUMP_ARGS = ['--format=custom', '--no-owner', '--no-acl'];
const SAFE_LABEL = /^[a-z0-9-]+$/;

// Runs pg_dump and returns the dump encrypted. The database URL (with its password) is passed to
// pg_dump but never put into an error: a failed spawn's own error lists its arguments.
async function dumpEncrypted(publicKey) {
  const dump = childProcess.spawn(
    'pg_dump',
    [...PG_DUMP_ARGS, `--dbname=${process.env.DATABASE_URL}`],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const exited = new Promise((resolve, reject) => {
    dump.on('error', () => reject(new Error('pg_dump could not be started. Is it installed?')));
    dump.on('close', resolve);
  });
  let stderr = '';
  dump.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const chunks = [];
  const collect = new Writable({
    write(chunk, encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
  const [, exitCode] = await Promise.all([
    pipeline(dump.stdout, createBackupEncryptor(publicKey), collect),
    exited,
  ]);
  if (exitCode !== 0) throw new Error(`pg_dump failed (exit code ${exitCode}): ${stderr.trim()}`);
  return Buffer.concat(chunks);
}

// `label` marks a backup that isn't the nightly run (`test` → backups/test-2026-…), so it is
// recognisable in the bucket. Returns the object key and the encrypted size in bytes.
async function backupDatabase({ label } = {}) {
  if (label !== undefined && !SAFE_LABEL.test(label)) {
    throw new Error('The label may only hold lowercase letters, digits and hyphens.');
  }
  const publicKey = backupPublicKey();
  const body = await dumpEncrypted(publicKey);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `backups/${label ? `${label}-` : ''}${timestamp}.dump.enc`;
  await putObject(key, body);
  return { key, size: body.length };
}

module.exports = backupDatabase;
