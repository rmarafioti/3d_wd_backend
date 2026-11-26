// Emails a client website's contact message, photos attached, to its site owners through
// lib/resend.js. Fire-and-forget: it never rejects, and sends nothing without RESEND_API_KEY.
const prisma = require('../prisma');
const { failureReason, isEmailOn, sendEmail } = require('../lib/resend');
const { reportWarning } = require('../lib/sentry');

// Logged with the inquiry id only, never an address, a name, the message or a photo.
function emailFailed(inquiryId, reason) {
  const message = `Website inquiry email failed for inquiry ${inquiryId}: ${reason}`;
  console.error(message);
  reportWarning(message, ['website-inquiry-email']);
}

// Plain text: who wrote, the form's own extra questions in the order sent, then the message.
function composeWebsiteInquiryEmail(inquiry, websiteName) {
  const lines = [`Name: ${inquiry.name}`, `Email: ${inquiry.email}`];
  for (const extra of inquiry.extras ?? []) lines.push(`${extra.label}: ${extra.value}`);
  if (inquiry.message) lines.push('', 'Message:', inquiry.message);
  if (inquiry.imageCount > 0) lines.push('', `Photos attached: ${inquiry.imageCount}`);
  lines.push('', `Reply to this email to answer ${inquiry.name}.`, '');
  return { subject: `New message from ${websiteName}: ${inquiry.name}`, text: lines.join('\n') };
}

// `images` are the photos as the route validated them, [{ filename, content }]: they reach the
// email only from memory and are never stored.
async function sendWebsiteInquiryEmail(inquiryId, images) {
  if (!isEmailOn()) return;
  try {
    const inquiry = await prisma.websiteInquiry.findUnique({
      where: { id: inquiryId },
      select: {
        name: true,
        email: true,
        message: true,
        extras: true,
        imageCount: true,
        website: {
          select: {
            websiteName: true,
            accountWebsites: {
              where: { account: { role: 'site_owner', active: true } },
              select: { account: { select: { email: true } } },
            },
          },
        },
      },
    });
    const owners = inquiry.website.accountWebsites.map((link) => link.account.email);
    if (owners.length === 0) return;

    const response = await sendEmail({
      to: owners,
      replyTo: inquiry.email,
      ...composeWebsiteInquiryEmail(inquiry, inquiry.website.websiteName),
      attachments: images,
    });
    if (!response.ok) emailFailed(inquiryId, `HTTP ${response.status}`);
  } catch (err) {
    // A timeout, a network failure or a database error: its name only for a database error, since
    // its message can quote the visitor's email.
    emailFailed(inquiryId, failureReason(err));
  }
}

module.exports = sendWebsiteInquiryEmail;
