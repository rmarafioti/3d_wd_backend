// Rate limits (docs/security.md → Rate limits): one limiter per route that can be hammered, each
// with its own in-memory store. Per-instance counts are fine while the API runs as one instance;
// several instances need a shared store (docs/scaling.md §7). The numbers are a few times real
// use of each route, to be tuned from the audit log after launch.
const { rateLimit, MemoryStore } = require('express-rate-limit');
const { ServerError } = require('../errors');

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;
const TOO_MANY_REQUESTS = 'Too many requests. Please try again later.';

const stores = [];

// Over the limit, the request is thrown to the error handler like any other error, so it leaves
// as the usual { error: { message } } envelope. Standard RateLimit-* headers are sent.
function createLimiter(options) {
  const store = new MemoryStore();
  stores.push(store);
  return rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store,
    handler: (req, res, next) => next(new ServerError(429, TOO_MANY_REQUESTS)),
    ...options,
  });
}

// POST /api/auth/login, per IP. Sign-in is through Google, so there is no password to guess:
// this stops floods, and a real person retries once or twice.
const loginRateLimit = createLimiter({ windowMs: FIFTEEN_MINUTES, limit: 5 });

// GET /api/public/* (posts and galleries) with a valid key, per website, one count for the
// whole public API (runs after requireApiKey). Keyed by website, not IP, because client websites
// on Vercel share outgoing IP addresses.
const publicApiRateLimit = createLimiter({
  windowMs: ONE_MINUTE,
  limit: 30,
  keyGenerator: (req) => req.website.id,
});

// GET /api/public/* with a refused key, per IP (runs before requireApiKey). Only the 401s
// requireApiKey throws are counted, so a website's valid calls never use it up.
const invalidApiKeyRateLimit = createLimiter({
  windowMs: ONE_MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
});

// POST /api/siteOwner/uploads/sign, per signed-in account (runs after requireAuth). One sign per
// Publish. It limits signatures, not uploads: one signature allows uploads for an hour.
const uploadSignRateLimit = createLimiter({
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  keyGenerator: (req) => req.user.id,
});

// Tests only: every test starts with empty counts.
async function resetRateLimits() {
  await Promise.all(stores.map((store) => store.resetAll()));
}

module.exports = {
  loginRateLimit,
  publicApiRateLimit,
  invalidApiKeyRateLimit,
  uploadSignRateLimit,
  resetRateLimits,
};
