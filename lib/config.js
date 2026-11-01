// Startup config check for the API server (index.js): every required environment variable is set,
// the secrets are strong enough, and production uses https and the shared cookie domain. Returns
// the problems instead of exiting, so it can be tested; index.js prints them and stops. The
// missing-variable check is shared with the scripts' entry points (scripts/), which each keep
// their own list.
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

// The names in `names` that `env` doesn't set (or sets to an empty string).
function missingEnv(names, env) {
  return names.filter((name) => !env[name]);
}

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
  return problems;
}

module.exports = { missingEnv, configProblems };
