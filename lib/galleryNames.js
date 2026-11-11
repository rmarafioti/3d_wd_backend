// A gallery's name rule: unique on its website among galleries not deleted, in any case, kept so
// under concurrent creates and restores by Serializable transactions and a retry.
const { setTimeout: sleep } = require('node:timers/promises');
const { ServerError } = require('../errors');

const GALLERY_NAME_TAKEN = 'A gallery with this name already exists.';
// Two writes at once can both fail their first try and clash again on the retry, so one is tried
// up to this many times before its clash is a 500.
const MAX_CLASH_ATTEMPTS = 5;

// Throws the 409 when another gallery on the website, not deleted, has this name in any case:
// two galleries with one name can't be told apart on the dashboard. `exceptId` is the gallery
// being edited or restored, which may keep its own name.
async function assertNameAvailable(tx, websiteId, galleryName, exceptId) {
  const taken = await tx.gallery.findFirst({
    where: {
      websiteId,
      deletedAt: null,
      galleryName: { equals: galleryName, mode: 'insensitive' },
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { id: true },
  });
  if (taken) throw new ServerError(409, GALLERY_NAME_TAKEN);
}

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

// Runs a Serializable gallery write (`write`), again while it clashes with a concurrent one. Once
// the other has committed, a retry answers the 409 for the same name, or saves.
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

module.exports = { assertNameAvailable, retryOnClash };
