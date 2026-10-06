// Prisma CLI configuration (Prisma 7). Tells the CLI where the schema, migrations and seed
// script live, and which database to connect to. Prisma 7 does not load .env on its own,
// so dotenv is loaded here first.
require('dotenv/config');
const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    // process.env rather than Prisma's env() helper: env() throws when the variable is unset,
    // which would break `prisma generate` on a fresh install even though generate needs no database.
    url: process.env.DATABASE_URL,
  },
});
