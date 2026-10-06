// Date-only helpers for postDate, which is a Postgres DATE (@db.Date) exposed in the API as
// "YYYY-MM-DD". Prisma reads and writes DATE values as JS Dates at UTC midnight.

// Date from Prisma → "YYYY-MM-DD", or null.
function toDateOnly(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

// Validated "YYYY-MM-DD" → Date at UTC midnight, or null.
function fromDateOnly(value) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

module.exports = { toDateOnly, fromDateOnly };
