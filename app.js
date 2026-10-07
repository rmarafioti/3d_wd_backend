// The Express app: the middleware stack in the order defined in docs/endpoints.md (Middleware
// Stack), the API routers, the 404 catch-all and the error handler. Exported without listening,
// so index.js starts the server and the tests send requests to it through Supertest.
// It does not load .env: whoever requires it (index.js, test/setup.js) sets the environment first.
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

module.exports = app;
