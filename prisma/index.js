// The single shared Prisma client for the whole app. Prisma 7 connects to Postgres through a
// driver adapter (PrismaPg) rather than a built-in engine.
// This file does not load .env: each entry point (index.js, prisma/seed.js) requires
// 'dotenv/config' before requiring this module, so DATABASE_URL is already set.
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
