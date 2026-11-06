// Scheduled publish: every draft post or gallery whose go-live date has passed becomes published,
// with its audit event, then its client website is revalidated. Safe to re-run.
const prisma = require('../prisma');
const { AUDIT_ACTIONS, recordAuditEvent } = require('../lib/audit');
const { toStatusData } = require('../lib/status');
const revalidate = require('./revalidate');

// The job has no request: its audit rows have no actor and no ip.
const NO_REQUEST = { ip: null };

const KINDS = [
  { model: 'post', action: AUDIT_ACTIONS.POST_PUBLISHED, idKey: 'postId' },
  { model: 'gallery', action: AUDIT_ACTIONS.GALLERY_PUBLISHED, idKey: 'galleryId' },
];

// Publishes one item, unless the site owner published, deleted or rescheduled it after it was
// found: the update's where re-checks every condition, so it changes nothing then and no event
// is written. Returns whether it was published.
function publishOne(kind, item, now) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx[kind.model].updateMany({
      where: { id: item.id, status: 'draft', deletedAt: null, publishAt: { lte: now } },
      data: toStatusData('published', 'draft', now),
    });
    if (count === 0) return false;

    await recordAuditEvent(tx, NO_REQUEST, {
      action: kind.action,
      targetType: kind.model,
      targetId: item.id,
      metadata: { websiteId: item.websiteId, scheduled: true },
    });
    return true;
  });
}

async function publishScheduled(now = new Date()) {
  const counts = {};
  const published = [];

  for (const kind of KINDS) {
    const due = await prisma[kind.model].findMany({
      where: { status: 'draft', deletedAt: null, publishAt: { lte: now } },
      select: { id: true, websiteId: true },
    });
    counts[kind.model] = 0;
    for (const item of due) {
      if (!(await publishOne(kind, item, now))) continue;
      counts[kind.model] += 1;
      published.push(revalidate(item.websiteId, { [kind.idKey]: item.id }));
    }
  }

  // Awaited so the process doesn't exit before the calls are sent; revalidate never rejects.
  await Promise.all(published);
  return { posts: counts.post, galleries: counts.gallery };
}

module.exports = publishScheduled;
