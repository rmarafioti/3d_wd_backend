// Entry point for `npm run sentry:check`: sends one labelled test error through lib/sentry.js, to
// prove production reports reach Sentry (docs/deploy.md).
require('dotenv/config');
const { initSentry, reportError, flushSentry } = require('../lib/sentry');

async function main() {
  if (!process.env.SENTRY_DSN) {
    console.error('SENTRY_DSN is not set, so Sentry is off.');
    process.exit(1);
  }
  initSentry();

  const service = process.env.RENDER_SERVICE_NAME || 'a local run';
  reportError(new Error(`Sentry check from ${service}`));
  const sent = await flushSentry();
  console.log(sent ? 'Sentry check sent.' : 'Sentry check could not be sent.');
  process.exitCode = sent ? 0 : 1;
}

main();
