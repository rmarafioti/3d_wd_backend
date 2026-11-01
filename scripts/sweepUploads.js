// Entry point for `npm run sweep:uploads`: deletes unused Cloudinary uploads
// (services/sweepUploads.js). Run by hand locally; once deployed, a daily Render cron job runs it.
// Logs counts only.
require('dotenv/config');
const { missingEnv } = require('../lib/config');

const REQUIRED_ENV = [
  'DATABASE_URL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'CLOUDINARY_FOLDER',
];
const missing = missingEnv(REQUIRED_ENV, process.env);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const prisma = require('../prisma');
const sweepUploads = require('../services/sweepUploads');

sweepUploads()
  .then(({ checked, deleted }) => {
    console.log(`Upload cleanup: checked ${checked}, deleted ${deleted}.`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
