// Entry point for `npm run backup:database`: an encrypted dump of the database, uploaded to R2
// (services/backupDatabase.js). A nightly Render cron job runs it in production; run by hand
// before a migration that drops or rewrites data. `-- --label test` marks a backup that isn't the
// nightly one. Logs the object key and size only. Exits 1 on any failure, so Render shows it, and
// reports the failure to Sentry in production (lib/sentry.js), so a failed night is an alert.
require('dotenv/config');
const { parseArgs } = require('node:util');
const { initSentry, reportError, flushSentry } = require('../lib/sentry');
const { missingEnv } = require('../lib/config');
const { backupPublicKey } = require('../lib/crypto');

const REQUIRED_ENV = [
  'DATABASE_URL',
  'BACKUP_PUBLIC_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
];
// Logs the message (never the error object, which could hold the database URL), reports it, and
// exits 1 once Sentry has sent it.
async function fail(message) {
  console.error(message);
  reportError(new Error(message));
  await flushSentry();
  process.exit(1);
}

async function main() {
  initSentry();

  const missing = missingEnv(REQUIRED_ENV, process.env);
  if (missing.length) {
    return fail(`Missing required environment variables: ${missing.join(', ')}`);
  }
  try {
    backupPublicKey();
  } catch (err) {
    return fail(err.message);
  }

  const backupDatabase = require('../services/backupDatabase');
  const { values } = parseArgs({ options: { label: { type: 'string' } } });

  try {
    const { key, size } = await backupDatabase({ label: values.label });
    console.log(`Database backup: uploaded ${key} (${size} bytes).`);
  } catch (err) {
    await fail(`Database backup failed: ${err.message}`);
  }
}

main();
