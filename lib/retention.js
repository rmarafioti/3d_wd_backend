// How long deleted content stays recoverable. A deleted post's or gallery's images are kept for
// 30 days, as long as database backups are (services/sweepUploads.js), so a restored backup or a
// mistaken delete still has them. A removed Photo Galleries ability can be added back with its
// galleries for the same 30 days (api/siteOwner/abilities.js), while their images still exist.
// It may come down to 15 days if storage gets tight.
const DELETED_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

module.exports = { DELETED_GRACE_MS };
