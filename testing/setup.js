// Test environment. Required first by every test file (and by testing/migrate.js), the way entry
// points require dotenv/config first, so it runs before anything reads process.env.
// It points the app at the test database and refuses any database whose name doesn't end in
// "_test": the suite truncates every table, so it must never reach the dev database.
// The other values are fixed, so tests never depend on a developer's .env.
require('dotenv/config');

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = testDatabaseUrl ? new URL(testDatabaseUrl).pathname.slice(1) : '';
if (!databaseName.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must be set to a database whose name ends in "_test".');
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.CORS_ORIGIN = 'http://localhost:3000';
delete process.env.COOKIE_DOMAIN;
