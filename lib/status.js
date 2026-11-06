// The columns a post's or gallery's draft / published change sets, shared by the status routes and
// the scheduled publish job so the rules can't drift between them.

// Publishing a draft stamps publishedAt (when it went live) and clears its go-live date; setting
// published again on a published item keeps its publishedAt. Drafting clears publishedAt.
function toStatusData(status, currentStatus, now = new Date()) {
  if (status === 'draft') return { status, publishedAt: null };
  if (currentStatus === 'published') return { status, publishAt: null };
  return { status, publishAt: null, publishedAt: now };
}

module.exports = { toStatusData };
