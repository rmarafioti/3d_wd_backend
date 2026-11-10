// Entry point for `npm run backup:database [-- --label test]`: an encrypted database dump uploaded
// to R2 (services/backupDatabase.js), nightly by a Render cron job and by hand before a migration.
require('dotenv/config');
const { parseArgs } = require('node:util');
const { initSentry, exitWithError } = require('../lib/sentry');
const { missingEnvMessage } = require('../lib/config');
const { backupPublicKey } = require('../lib/crypto');
const backupDatabase = require('../services/backupDatabase');

const REQUIRED_ENV = [
  'DATABASE_URL',
  'BACKUP_PUBLIC_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
];
async function main() {
  initSentry();

  const missing = missingEnvMessage(REQUIRED_ENV, process.env);
  if (missing) return exitWithError(missing);
  try {
    backupPublicKey();
  } catch (err) {
    return exitWithError(err.message);
  }

  const { values } = parseArgs({ options: { label: { type: 'string' } } });

  try {
    const { key, size } = await backupDatabase({ label: values.label });
    console.log(`Database backup: uploaded ${key} (${size} bytes).`);
  } catch (err) {
    await exitWithError(`Database backup failed: ${err.message}`);
  }
}

main();
