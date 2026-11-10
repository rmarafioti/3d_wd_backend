// Entry point for `npm run publish:scheduled` (services/publishScheduled.js), run every 15 minutes
// by a Render cron job. Logs counts only; on a failure exits 1 and reports to Sentry.
require('dotenv/config');
const { initSentry, reportError, flushSentry, exitWithError } = require('../lib/sentry');
const { missingEnvMessage } = require('../lib/config');

// SECRET_ENCRYPTION_KEY decrypts each website's webhook secret for the revalidation call.
const REQUIRED_ENV = ['DATABASE_URL', 'SECRET_ENCRYPTION_KEY'];

async function main() {
  initSentry();

  const missing = missingEnvMessage(REQUIRED_ENV, process.env);
  if (missing) return exitWithError(missing);

  // Required only once the env is checked: prisma/index.js reads DATABASE_URL as it loads.
  const prisma = require('../prisma');
  const publishScheduled = require('../services/publishScheduled');

  try {
    const { posts, galleries } = await publishScheduled();
    console.log(`Scheduled publish: published ${posts} posts, ${galleries} galleries.`);
  } catch (err) {
    console.error(err);
    reportError(err);
    process.exitCode = 1;
  } finally {
    // Flushed on success too: a failed revalidation is reported to Sentry as a warning.
    await flushSentry();
    await prisma.$disconnect();
  }
}

main();
