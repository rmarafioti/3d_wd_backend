// Emails the admin when a site owner sends or edits a request message: where on their website
// posts or a gallery should go (Feature 13, issue #65). Sent through Resend's REST API from
// notifications@3dwebdev.com to every active admin, with Reply-To set to the site owner, so the
// admin's reply (the styling mock-up) starts a thread with them. Plain text only: names, the
// ability and the note. No ids, no post or gallery content, no secrets, no link but the dashboard.
//
// Fire-and-forget, like services/revalidate.js: routes call it after their transaction has
// committed and after responding, without awaiting it. It catches every error itself and never
// rejects, so a failed send can never affect the site owner's request. The note stays on the admin
// dashboard either way, so a lost email loses nothing.
//
// Production only: with RESEND_API_KEY empty (locally, in tests and on staging) nothing is sent.
// At most 10 emails per website in 24 hours (lib/emailCap.js); a message past the cap is still
// saved, only its email is skipped. Logs and Sentry get the website id only, never an address, the key or the note.
const prisma = require('../prisma');
const { reportWarning } = require('../lib/sentry');
const { withinEmailCap } = require('../lib/emailCap');

const RESEND_URL = 'https://api.resend.com/emails';
const FROM = '3D Web Dev <notifications@3dwebdev.com>';
const DASHBOARD_URL = 'https://3dwebdev.com/admin';
const TIMEOUT_MS = 5000;

// A subject is one line: a name with a line break in it can't add a header.
function oneLine(text) {
  return text.replace(/[\r\n]+/g, ' ');
}

function emailFailed(websiteId, reason) {
  const message = `Request email failed for website ${websiteId}: ${reason}`;
  console.error(message);
  reportWarning(message, ['request-email', websiteId]);
}

// What the message is about and its note: the posts ability's, or one gallery's.
async function findRequest({ abilityId, galleryId }) {
  if (abilityId) {
    const ability = await prisma.websiteAbility.findUnique({
      where: { id: abilityId },
      select: { requestNote: true },
    });
    return { label: 'Posts', note: ability.requestNote };
  }
  const gallery = await prisma.gallery.findUnique({
    where: { id: galleryId },
    select: { galleryName: true, requestNote: true },
  });
  return { label: `Photo Galleries "${gallery.galleryName}"`, note: gallery.requestNote };
}

// The subject and plain-text body.
function composeEmail({ siteOwnerName, websiteName, label, note, isUpdate }) {
  const subject = `${isUpdate ? 'Updated' : 'New'} request: ${label} on ${websiteName}`;
  const opening = isUpdate
    ? `${siteOwnerName} has changed where ${label} should go on ${websiteName}.`
    : `${siteOwnerName} has requested ${label} on ${websiteName}.`;
  const text = [
    opening,
    '',
    'Where it should go:',
    note,
    '',
    `Reply to this email to send ${siteOwnerName} the mock-up.`,
    DASHBOARD_URL,
    '',
  ].join('\n');
  return { subject: oneLine(subject), text };
}

// `request` is { siteOwnerId, abilityId } for posts or { siteOwnerId, galleryId } for a gallery,
// and `isUpdate` is true when an earlier message was edited.
async function sendRequestEmail(websiteId, { siteOwnerId, abilityId, galleryId, isUpdate }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  try {
    if (!withinEmailCap(websiteId)) {
      console.error(`Request email skipped for website ${websiteId}: over the daily cap`);
      return;
    }

    const [siteOwner, website, admins, request] = await Promise.all([
      prisma.account.findUnique({
        where: { id: siteOwnerId },
        select: { name: true, email: true },
      }),
      prisma.website.findUnique({ where: { id: websiteId }, select: { websiteName: true } }),
      prisma.account.findMany({
        where: { role: 'admin', active: true },
        select: { email: true },
      }),
      findRequest({ abilityId, galleryId }),
    ]);
    if (admins.length === 0) return;

    const { subject, text } = composeEmail({
      siteOwnerName: siteOwner.name,
      websiteName: website.websiteName,
      label: request.label,
      note: request.note,
      isUpdate,
    });
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: admins.map((admin) => admin.email),
        reply_to: siteOwner.email,
        subject,
        text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) emailFailed(websiteId, `HTTP ${response.status}`);
  } catch (err) {
    // Timeout, network failure or a database error. Only the error's name and message are
    // logged, never the key, an address or the note.
    emailFailed(websiteId, `${err.name}: ${err.message}`);
  }
}

module.exports = sendRequestEmail;
