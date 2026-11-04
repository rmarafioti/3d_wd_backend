// The single shared Prisma client, connected to Postgres through Prisma 7's driver adapter
// (PrismaPg). It doesn't load .env: each entry point does that first.
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
