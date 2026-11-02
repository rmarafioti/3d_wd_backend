// Server entry point. Loads .env, starts Sentry (lib/sentry.js, production only) before anything
// else loads so it can see Express, checks the config (lib/config.js), then starts the Express app
// from app.js.
require('dotenv/config');
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
