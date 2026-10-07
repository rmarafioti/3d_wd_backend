// Server entry point. Loads .env, checks required config, then starts the Express app from app.js.
require('dotenv/config');

const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'CORS_ORIGIN',
  'SECRET_ENCRYPTION_KEY',
];
const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = require('./app');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
