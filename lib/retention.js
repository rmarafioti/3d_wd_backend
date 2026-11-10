// How long deleted content stays recoverable: 30 days, as long as database backups are kept
// (docs/setup.md → Upload cleanup).
const DELETED_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

// Anything deleted after this moment can still be restored. It only moves forward, so an item a
// restore accepts has never had its images swept (services/sweepUploads.js uses the same cutoff).
function restoreCutoff() {
  return new Date(Date.now() - DELETED_GRACE_MS);
}

// The last moment an item deleted at `deletedAt` can be restored: the contract's
// restorableUntil.
function restorableUntil(deletedAt) {
  return new Date(deletedAt.getTime() + DELETED_GRACE_MS);
}

module.exports = { restoreCutoff, restorableUntil };
