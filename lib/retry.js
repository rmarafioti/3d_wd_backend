// Retrying a write that lost to a concurrent one: a gallery name or a post slug clash, retried
// after a short random pause until the rival has committed.
const { setTimeout: sleep } = require('node:timers/promises');

// Two writes at once can both fail their first try and clash again on the retry, so one is tried
// up to this many times before its clash is a 500.
const MAX_CLASH_ATTEMPTS = 5;

// A write that lost to a concurrent one: a serialization failure (Postgres 40001, which the pg
// driver adapter raises at commit as TransactionWriteConflict, or Prisma's P2034) or a unique
// index clash (P2002).
function isClash(err) {
  return (
    err.code === 'P2002' || err.code === 'P2034' || err.cause?.kind === 'TransactionWriteConflict'
  );
}

// A short random pause before retry `attempt`, longer each time. Retrying at once can meet the
// same rival still uncommitted on a slow machine, and two losers retrying in step clash again.
function pauseBeforeRetry(attempt) {
  return sleep(attempt * (10 + Math.random() * 40));
}

// Runs a write (`write`), again while it clashes with a concurrent one. Once the other has
// committed, a retry sees its row: a gallery write answers the 409 for the same name, a post
// create picks the next free slug, or either saves.
async function retryOnClash(write) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await write();
    } catch (err) {
      if (!isClash(err) || attempt === MAX_CLASH_ATTEMPTS) throw err;
    }
    await pauseBeforeRetry(attempt);
  }
}

module.exports = { retryOnClash };
