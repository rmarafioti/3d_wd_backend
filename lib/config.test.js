// Tests for lib/config.js: the startup config check index.js runs before starting the server.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { missingEnv, configProblems } = require('./config');

// A config that passes every check; override any variable.
function env(overrides = {}) {
  return {
    DATABASE_URL: 'postgresql://localhost:5433/headless_cms',
    JWT_SECRET: 'x'.repeat(32),
    GOOGLE_CLIENT_ID: 'client-id',
    CORS_ORIGIN: 'http://localhost:3000',
    SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    CLOUDINARY_CLOUD_NAME: 'cloud',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
    CLOUDINARY_FOLDER: '3dwd-dev',
    ...overrides,
  };
}

describe('missingEnv', () => {
  it('returns the names that are unset or empty, in list order', () => {
    const env = { A: 'set', C: '' };

    assert.deepEqual(missingEnv(['A', 'B', 'C'], env), ['B', 'C']);
  });

  it('returns an empty list when every name is set', () => {
    assert.deepEqual(missingEnv(['A'], { A: 'set' }), []);
  });
});

describe('configProblems', () => {
  it('returns no problems for a complete local config', () => {
    assert.deepEqual(configProblems(env()), []);
  });

  it('names every missing variable', () => {
    const problems = configProblems(env({ JWT_SECRET: undefined, CLOUDINARY_FOLDER: '' }));

    assert.deepEqual(problems, [
      'Missing required environment variables: JWT_SECRET, CLOUDINARY_FOLDER',
    ]);
  });

  it('refuses a JWT secret shorter than 32 characters', () => {
    assert.deepEqual(configProblems(env({ JWT_SECRET: 'x'.repeat(31) })), [
      'JWT_SECRET must be at least 32 characters.',
    ]);
  });

  it('refuses an encryption key that is not 32 bytes', () => {
    const shortKey = Buffer.alloc(16, 7).toString('base64');

    assert.deepEqual(configProblems(env({ SECRET_ENCRYPTION_KEY: shortKey })), [
      'SECRET_ENCRYPTION_KEY must be 32 bytes, base64-encoded.',
    ]);
  });

  it('requires an https CORS origin and the cookie domain in production', () => {
    const problems = configProblems(env({ NODE_ENV: 'production' }));

    assert.deepEqual(problems, [
      'CORS_ORIGIN must start with https:// in production.',
      'COOKIE_DOMAIN must be set in production.',
    ]);
  });

  it('accepts a complete production config', () => {
    const production = env({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://3dwebdev.com',
      COOKIE_DOMAIN: '.3dwebdev.com',
    });

    assert.deepEqual(configProblems(production), []);
  });

  it('never puts a secret value in a message', () => {
    const secret = 'short-but-secret';

    const problems = configProblems(env({ JWT_SECRET: secret }));

    assert.ok(!problems.join(' ').includes(secret));
  });
});
