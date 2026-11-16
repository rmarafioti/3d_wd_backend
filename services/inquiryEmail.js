// Emails a contact form inquiry to the admin and a fixed confirmation to its sender, through
// lib/resend.js. Fire-and-forget: it never rejects, and sends nothing without RESEND_API_KEY.
const prisma = require('../prisma');
const { failureReason, isEmailOn, sendEmail } = require('../lib/resend');
const { reportWarning } = require('../lib/sentry');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// The sentence the form shows for each startingPoint key.
const STARTING_POINTS = {
  has_website: "I have a website, but it isn't bringing in work",
  unfinished_website: "I started a website, but didn't finish it",
  no_website: "I don't have a website yet",
};

// Fixed text that repeats nothing the sender typed, so the form can't be used to send a message to
// someone else's address. It has no Reply-To: 3dwebdev.com receives no mail.
const CONFIRMATION = {
  subject: 'Thanks for getting in touch',
  text: [
    'Thanks for reaching out to 3D Web Dev. Your message has been sent, ' +
      "and I'll reply to you soon.",
    '',
    "This address doesn't receive replies.",
    '',
    'Rich',
    '3D Web Dev',
    'https://3dwebdev.com',
    '',
  ].join('\n'),
};

// Logged with the inquiry id only, never an address, a name or the message.
function emailFailed(inquiryId, reason) {
  const message = `Inquiry email failed for inquiry ${inquiryId}: ${reason}`;
  console.error(message);
  reportWarning(message, ['inquiry-email']);
}

// The admin's email: every field, with Reply-To the sender so the admin answers with Reply.
function composeInquiryEmail(inquiry) {
  const text = [
    `Name: ${inquiry.name}`,
    `Business: ${inquiry.business}`,
    `Email: ${inquiry.email}`,
    `Starting from: ${STARTING_POINTS[inquiry.startingPoint]}`,
    '',
    'What they want their site to do:',
    inquiry.goal,
    '',
    `Reply to this email to answer ${inquiry.name}.`,
    '',
  ].join('\n');
  return { subject: `New inquiry: ${inquiry.business}`, text };
}

// True when the same address sent an earlier inquiry in the 24 hours before this one. Ids are
// UUIDv7, so a smaller id is an earlier inquiry, even one saved in the same millisecond.
async function hasRecentInquiry(inquiry) {
  const earlier = await prisma.inquiry.findFirst({
    where: {
      email: inquiry.email,
      id: { lt: inquiry.id },
      createdAt: { gte: new Date(inquiry.createdAt.getTime() - ONE_DAY_MS) },
    },
    select: { id: true },
  });
  return Boolean(earlier);
}

// Sends one email, logging a failure without throwing, so one failed email never stops the other.
async function trySend(inquiryId, email) {
  try {
    const response = await sendEmail(email);
    if (!response.ok) emailFailed(inquiryId, `HTTP ${response.status}`);
  } catch (err) {
    // A timeout or network failure.
    emailFailed(inquiryId, failureReason(err));
  }
}

async function sendInquiryEmails(inquiryId) {
  if (!isEmailOn()) return;
  try {
    const [inquiry, admins] = await Promise.all([
      prisma.inquiry.findUnique({
        where: { id: inquiryId },
        select: {
          id: true,
          name: true,
          business: true,
          email: true,
          startingPoint: true,
          goal: true,
          createdAt: true,
        },
      }),
      prisma.account.findMany({
        where: { role: 'admin', active: true },
        select: { email: true },
      }),
    ]);
    const isRepeat = await hasRecentInquiry(inquiry);

    const sends = [];
    if (admins.length > 0) {
      sends.push(
        trySend(inquiryId, {
          to: admins.map((admin) => admin.email),
          replyTo: inquiry.email,
          ...composeInquiryEmail(inquiry),
        }),
      );
    }
    if (!isRepeat) sends.push(trySend(inquiryId, { to: [inquiry.email], ...CONFIRMATION }));
    await Promise.all(sends);
  } catch (err) {
    // A database error: its name only, since its message can quote the sender's email.
    emailFailed(inquiryId, failureReason(err));
  }
}

module.exports = sendInquiryEmails;
