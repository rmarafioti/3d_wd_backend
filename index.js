// Express app entry point. Loads .env, checks required config, then applies the middleware
// stack in the order defined in docs/endpoints.md (Middleware Stack).
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

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const requireCsrfHeader = require('./middleware/requireCsrfHeader');
const apiRouter = require('./api');
const { errorHandler, ServerError } = require('./errors');

const app = express();

app.use(helmet());
// Exact origin, never a wildcard: browsers refuse credentialed responses with `*`.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Protection', 'Authorization'],
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(requireCsrfHeader);

app.use('/api', apiRouter);

// Unknown routes still get the JSON error envelope instead of Express's HTML page.
app.use(() => {
  throw new ServerError(404, 'Not found.');
});

app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
