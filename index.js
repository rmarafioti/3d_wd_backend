// Server entry point. Loads .env, checks the config (lib/config.js), then starts the Express app
// from app.js.
require('dotenv/config');
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
