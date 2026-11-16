// Emails the admin (lib/resend.js) when a site owner sends or edits a request message.
// Fire-and-forget: it never rejects, and nothing is sent while RESEND_API_KEY is empty.
const prisma = require('../prisma');
const { failureReason, isEmailOn, sendEmail } = require('../lib/resend');
const { reportWarning } = require('../lib/sentry');

const DASHBOARD_URL = 'https://3dwebdev.com/admin';

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
  return { subject, text };
}

// `request` is { siteOwnerId, abilityId } for posts or { siteOwnerId, galleryId } for a gallery,
// and `isUpdate` is true when an earlier message was edited.
async function sendRequestEmail(websiteId, { siteOwnerId, abilityId, galleryId, isUpdate }) {
  if (!isEmailOn()) return;
  try {
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
    const response = await sendEmail({
      to: admins.map((admin) => admin.email),
      replyTo: siteOwner.email,
      subject,
      text,
    });

    if (!response.ok) emailFailed(websiteId, `HTTP ${response.status}`);
  } catch (err) {
    // Timeout, network failure or a database error, never logged with the key, an address or
    // the note.
    emailFailed(websiteId, failureReason(err));
  }
}

module.exports = sendRequestEmail;
