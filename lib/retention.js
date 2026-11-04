// How long deleted content stays recoverable: 30 days, as long as database backups are kept
// (docs/setup.md → Upload cleanup).
const DELETED_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

module.exports = { DELETED_GRACE_MS };
