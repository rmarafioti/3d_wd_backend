// Entry point for `npm run sweep:uploads`: deletes unused Cloudinary uploads
// (services/sweepUploads.js). Run by hand locally; once deployed, a daily Render cron job runs it.
// Logs counts only. Exits 1 on any failure, and reports it to Sentry in production
// (lib/sentry.js), so a failed run is an alert.
require('dotenv/config');
const { initSentry, reportError, flushSentry } = require('../lib/sentry');
const { missingEnv } = require('../lib/config');

const REQUIRED_ENV = [
  'DATABASE_URL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'CLOUDINARY_FOLDER',
];
async function main() {
  initSentry();

  const missing = missingEnv(REQUIRED_ENV, process.env);
  if (missing.length) {
    const err = new Error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error(err.message);
    reportError(err);
    await flushSentry();
    process.exit(1);
  }

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
