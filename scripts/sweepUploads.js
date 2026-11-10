// Entry point for `npm run sweep:uploads` (services/sweepUploads.js), run daily by a Render cron
// job. Logs counts only; on a failure exits 1 and reports to Sentry.
require('dotenv/config');
const { initSentry, reportError, flushSentry, exitWithError } = require('../lib/sentry');
const { missingEnvMessage } = require('../lib/config');

const REQUIRED_ENV = [
  'DATABASE_URL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'CLOUDINARY_FOLDER',
];
async function main() {
  initSentry();

  const missing = missingEnvMessage(REQUIRED_ENV, process.env);
  if (missing) return exitWithError(missing);

  // Required only once the env is checked: prisma/index.js reads DATABASE_URL as it loads.
  const prisma = require('../prisma');
  const sweepUploads = require('../services/sweepUploads');

  try {
    const { checked, deleted } = await sweepUploads();
    console.log(`Upload cleanup: checked ${checked}, deleted ${deleted}.`);
  } catch (err) {
    console.error(err);
    reportError(err);
    await flushSentry();
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
