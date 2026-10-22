// The audit log: one append-only audit_event row per sign-in, sign-out and change
// (docs/security.md → Audit log). An event for a database change is written with the transaction
// client `tx` inside that change's $transaction, so a saved change always has its event and a
// rolled-back one leaves none. Nothing reads, edits or deletes these rows through the API.
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
  POST_ARCHIVED: 'post.archived',
  POST_ACTIVATED: 'post.activated',
};

// `db` is the shared Prisma client or a transaction client. req.ip is the client's address, read
// through the one proxy app.js trusts. actorEmail sits beside actorId so a row reads at a glance,
// and names who tried a failed login that has no account.
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
