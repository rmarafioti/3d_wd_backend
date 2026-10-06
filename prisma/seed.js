// Seeds the administrator account. Safe to run more than once: an existing account with the
// same email is skipped. Refuses to run against production unless --confirm-production is passed.
// Run with `npm run seed` (or `npm run seed -- --confirm-production` in production).

// Load .env before seedData and the Prisma client read process.env.
require('dotenv/config');

if (process.env.NODE_ENV === 'production' && !process.argv.includes('--confirm-production')) {
  console.error('Refusing to seed production. Re-run with: npm run seed -- --confirm-production');
  process.exit(1);
}

const prisma = require('./index');
const { admin } = require('./seedData');

async function main() {
  if (!admin.email) {
    throw new Error('SEED_ADMIN_EMAIL is not set in .env');
  }

  const email = admin.email.trim().toLowerCase();

  const existing = await prisma.account.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists, skipped.`);
    return;
  }

  // id, active and timestamps come from the schema defaults.
  const created = await prisma.account.create({
    data: { name: admin.name, email, role: admin.role },
  });
  console.log(`Admin ${created.email} created (id ${created.id}).`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
