// The audit log: one append-only audit_event row per sign-in, sign-out and change
// (docs/security.md → Audit log). An event for a database change is written with the transaction
// client `tx` inside that change's $transaction, so a saved change always has its event and a
// rolled-back one leaves none. The only reads through the API are the admin's audit event list and
// its months (GET /api/admin/auditEvents, /auditEvents/months); nothing edits or deletes these rows.
// metadata must never hold a key, secret, token, Google credential, header or post content.

const AUDIT_ACTIONS = {
  LOGIN_SUCCEEDED: 'auth.login_succeeded',
  LOGIN_FAILED: 'auth.login_failed',
  LOGOUT: 'auth.logout',
  ACCOUNT_CREATED: 'account.created',
  WEBSITE_CREATED: 'website.created',
  WEBSITE_LINKED: 'website.linked',
  POST_CREATED: 'post.created',
  POST_UPDATED: 'post.updated',
  // Rows written before Feature 8 name these post.archived and post.activated.
  POST_DRAFTED: 'post.drafted',
  POST_PUBLISHED: 'post.published',
  POST_DELETED: 'post.deleted',
  GALLERY_CREATED: 'gallery.created',
  GALLERY_UPDATED: 'gallery.updated',
  GALLERY_DRAFTED: 'gallery.drafted',
  GALLERY_PUBLISHED: 'gallery.published',
  GALLERY_DELETED: 'gallery.deleted',
};

// `db` is the shared Prisma client or a transaction client. req.ip is the client's address, read
// through the proxies app.js trusts (trust proxy 2: Cloudflare, then Render's load balancer).
// actorEmail sits beside actorId so a row reads at a glance, and names who tried a failed login
// that has no account.
function recordAuditEvent(
  db,
  req,
  { action, actorId, actorEmail, targetType, targetId, metadata },
) {
  return db.auditEvent.create({
    data: { action, actorId, actorEmail, targetType, targetId, metadata, ip: req.ip },
    select: { id: true },
  });
}

module.exports = { AUDIT_ACTIONS, recordAuditEvent };
