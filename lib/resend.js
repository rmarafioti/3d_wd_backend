// The one Resend call, shared by the request and inquiry emails; the only reader of RESEND_API_KEY.
// Nothing is sent while the key is empty (locally, in tests and on staging).
const RESEND_URL = 'https://api.resend.com/emails';
const FROM = '3D Web Dev <notifications@3dwebdev.com>';
const TIMEOUT_MS = 5000;

// A subject is one line: a name with a line break in it can't add a header.
function oneLine(text) {
  return text.replace(/[\r\n]+/g, ' ');
}

// What a failed email's log line says about the error. A Prisma error gives only its name: its
// message can quote the query's values, such as an email address. A fetch error (a timeout or a
// network failure) carries no data, so its message is kept.
function failureReason(err) {
  if (err.name?.startsWith('PrismaClient')) return err.name;
  return `${err.name}: ${err.message}`;
}

// True when emails are sent, so a service can skip its database reads when they aren't.
function isEmailOn() {
  return Boolean(process.env.RESEND_API_KEY);
}

// Resolves to Resend's response. Rejects on a timeout or network error: the caller catches it, and
// logs neither the key nor an address. Callers check isEmailOn() first.
function sendEmail({ to, replyTo, subject, text }) {
  return fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to,
      ...(replyTo && { reply_to: replyTo }),
      subject: oneLine(subject),
      text,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

module.exports = { failureReason, isEmailOn, sendEmail };
