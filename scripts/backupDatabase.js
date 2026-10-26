// Entry point for `npm run backup:database`: an encrypted dump of the database, uploaded to R2
// (services/backupDatabase.js). A nightly Railway cron service runs it in production; run by hand
// before a migration that drops or rewrites data. `-- --label test` marks a backup that isn't the
// nightly one. Logs the object key and size only. Exits 1 on any failure, so Railway shows it.
require('dotenv/config');
const { parseArgs } = require('util');
const { backupPublicKey } = require('../lib/crypto');

const REQUIRED_ENV = [
  'DATABASE_URL',
  'BACKUP_PUBLIC_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
];
const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
try {
  backupPublicKey();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const backupDatabase = require('../services/backupDatabase');

const { values } = parseArgs({ options: { label: { type: 'string' } } });

backupDatabase({ label: values.label })
  .then(({ key, size }) => {
    console.log(`Database backup: uploaded ${key} (${size} bytes).`);
  })
  .catch((err) => {
    console.error(`Database backup failed: ${err.message}`);
    process.exitCode = 1;
  });
