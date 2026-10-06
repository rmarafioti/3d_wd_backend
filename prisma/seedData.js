// Data for prisma/seed.js. Only the administrator is seeded; site owners are created through
// the real Create an Account flow. The email comes from .env and is never hardcoded.
const admin = {
  name: 'Richard Marafioti',
  email: process.env.SEED_ADMIN_EMAIL,
  role: 'admin',
};

module.exports = { admin };
