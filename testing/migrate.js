// Runs before `npm test` (the pretest script): creates the test database if it doesn't exist yet,
// then applies every migration to it with `prisma migrate deploy`. testing/setup.js has already
// checked that DATABASE_URL points at a "_test" database.
require('./setup');
const { execFileSync } = require('child_process');
const { Client } = require('pg');

async function createDatabaseIfMissing() {
  const url = new URL(process.env.DATABASE_URL);
  const databaseName = url.pathname.slice(1);
  // Connect to the server's default "postgres" database to check for, and create, the test one.
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (!rowCount) await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }
}

async function migrate() {
  await createDatabaseIfMissing();
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
}

migrate().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
