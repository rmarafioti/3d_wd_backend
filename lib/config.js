// Startup config check for the API server: required env vars are set, the secrets are strong
// enough, and production uses https and the shared cookie domain.
const { encryptionKey } = require('./crypto');

const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'CORS_ORIGIN',
  'SECRET_ENCRYPTION_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'CLOUDINARY_FOLDER',
];
const MIN_JWT_SECRET_LENGTH = 32;

// Shared with the scripts' entry points (scripts/), which each check their own list.
// The names in `names` that `env` doesn't set (or sets to an empty string).
function missingEnv(names, env) {
  return names.filter((name) => !env[name]);
}

// Returns the problems instead of exiting, so it can be tested; index.js prints them and stops.
// `env` is process.env, or a plain object in tests. Never includes a secret's value in a message.
function configProblems(env) {
  const missing = missingEnv(REQUIRED_ENV, env);
  if (missing.length) return [`Missing required environment variables: ${missing.join(', ')}`];

  const problems = [];
  if (env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters.`);
  }
  try {
    encryptionKey(env.SECRET_ENCRYPTION_KEY);
  } catch (err) {
    problems.push(err.message);
  }
  if (env.NODE_ENV === 'production') {
    if (!env.CORS_ORIGIN.startsWith('https://')) {
      problems.push('CORS_ORIGIN must start with https:// in production.');
    }
    if (!env.COOKIE_DOMAIN) problems.push('COOKIE_DOMAIN must be set in production.');
  }
  // Optional: empty means Sentry is off (lib/sentry.js).
  if (env.SENTRY_DSN && !env.SENTRY_DSN.startsWith('https://')) {
    problems.push('SENTRY_DSN must start with https:// when set.');
  }
  // Optional: empty means request emails are off (services/requestEmail.js). Resend's keys start
  // with re_, so a value pasted into the wrong variable is caught at start-up.
  if (env.RESEND_API_KEY && !env.RESEND_API_KEY.startsWith('re_')) {
    problems.push('RESEND_API_KEY must start with re_ when set.');
  }
  return problems;
}

module.exports = { missingEnv, configProblems };
