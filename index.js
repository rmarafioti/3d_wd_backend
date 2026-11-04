// Server entry point: loads .env, starts Sentry, checks the config (lib/config.js), then starts the
// Express app from app.js.
require('dotenv/config');
// Sentry starts before anything else loads, so it can see Express.
const { initSentry } = require('./lib/sentry');

initSentry();

const { configProblems } = require('./lib/config');

const problems = configProblems(process.env);
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

const app = require('./app');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
