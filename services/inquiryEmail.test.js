// Tests for services/inquiryEmail.js: the admin's email and the sender's confirmation, one
// confirmation per address a day, each email failing on its own, and failures logged by id only.
require('../testing/setup');
const { describe, it, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../prisma');
const sendInquiryEmails = require('./inquiryEmail');
const { resetState, disconnect, createAdmin, mockFetch } = require('../testing/helpers');

const API_KEY = 're_test_key';
const CONFIRMATION_TEXT = [
  "Thanks for reaching out to 3D Web Dev. Your message has been sent, and I'll reply to you soon.",
  '',
  "This address doesn't receive replies.",
  '',
  'Rich',
  '3D Web Dev',
  'https://3dwebdev.com',
  '',
].join('\n');

let fetchMock;

beforeEach(async () => {
  await resetState();
  process.env.RESEND_API_KEY = API_KEY;
  fetchMock = mockFetch(mock);
});
afterEach(() => {
  delete process.env.RESEND_API_KEY;
  mock.restoreAll();
});
after(disconnect);

function createInquiry(overrides = {}) {
  return prisma.inquiry.create({
    data: {
      name: 'Sam Rivera',
      business: 'Rivera Tattoo',
      email: 'sam@example.com',
      startingPoint: 'has_website',
      goal: 'Bring in bookings.',
      ...overrides,
    },
  });
}

// Every email sent to fetch, as its parsed body, keyed by its first recipient.
function sentEmails() {
  const emails = {};
  for (const call of fetchMock.mock.calls) {
    const body = JSON.parse(call.arguments[1].body);
    emails[body.to[0]] = body;
  }
  return emails;
}

describe('sendInquiryEmails', () => {
  it('emails every active admin with Reply-To the sender, and confirms to the sender', async () => {
    await createAdmin({ email: 'rich@example.com' });
    await createAdmin({ email: 'gone@example.com', active: false });
    const inquiry = await createInquiry();

    await sendInquiryEmails(inquiry.id);

    assert.equal(fetchMock.mock.callCount(), 2);
    const emails = sentEmails();
    assert.deepEqual(emails['rich@example.com'], {
      from: '3D Web Dev <notifications@3dwebdev.com>',
      to: ['rich@example.com'],
      reply_to: 'sam@example.com',
      subject: 'New inquiry: Rivera Tattoo',
      text: [
        'Name: Sam Rivera',
        'Business: Rivera Tattoo',
        'Email: sam@example.com',
        "Starting from: I have a website, but it isn't bringing in work",
        '',
        'What they want their site to do:',
        'Bring in bookings.',
        '',
        'Reply to this email to answer Sam Rivera.',
        '',
      ].join('\n'),
    });
    assert.deepEqual(emails['sam@example.com'], {
      from: '3D Web Dev <notifications@3dwebdev.com>',
      to: ['sam@example.com'],
      subject: 'Thanks for getting in touch',
      text: CONFIRMATION_TEXT,
    });
  });

  it('keeps the subject to one line when the business holds a line break', async () => {
    await createAdmin({ email: 'rich@example.com' });
    const inquiry = await createInquiry({ business: 'Rivera\r\nBcc: someone@example.com' });

    await sendInquiryEmails(inquiry.id);

    assert.equal(
      sentEmails()['rich@example.com'].subject,
      'New inquiry: Rivera Bcc: someone@example.com',
    );
  });

  it('sends no confirmation when the address sent an inquiry in the previous 24 hours', async () => {
    await createAdmin({ email: 'rich@example.com' });
    await createInquiry({ createdAt: new Date(Date.now() - 23 * 60 * 60 * 1000) });
    const inquiry = await createInquiry();

    await sendInquiryEmails(inquiry.id);

    assert.deepEqual(Object.keys(sentEmails()), ['rich@example.com']);
  });

  it('confirms again once the earlier inquiry is over 24 hours old', async () => {
    await createAdmin({ email: 'rich@example.com' });
    await createInquiry({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    const inquiry = await createInquiry();

    await sendInquiryEmails(inquiry.id);

    assert.deepEqual(Object.keys(sentEmails()).sort(), ['rich@example.com', 'sam@example.com']);
  });

  it('sends nothing when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    await createAdmin();
    const inquiry = await createInquiry();

    await sendInquiryEmails(inquiry.id);

    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('sends the confirmation when the admin email fails, logging the inquiry id only', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    await createAdmin({ email: 'rich@example.com' });
    const inquiry = await createInquiry({ name: 'Secret Name', goal: 'Secret goal' });
    fetchMock.mock.mockImplementation(async (url, options) =>
      JSON.parse(options.body).to[0] === 'rich@example.com'
        ? new Response(null, { status: 422 })
        : new Response(null, { status: 200 }),
    );

    const result = await sendInquiryEmails(inquiry.id);

    assert.equal(result, undefined);
    assert.equal(fetchMock.mock.callCount(), 2);
    const logged = errors.mock.calls.map((call) => call.arguments.join(' '));
    assert.deepEqual(logged, [`Inquiry email failed for inquiry ${inquiry.id}: HTTP 422`]);
  });

  it('logs a network failure without an address, name or message, and never rejects', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    await createAdmin({ email: 'rich@example.com' });
    const inquiry = await createInquiry({ name: 'Secret Name', goal: 'Secret goal' });
    fetchMock.mock.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });

    await sendInquiryEmails(inquiry.id);

    const logged = errors.mock.calls.map((call) => call.arguments.join(' '));
    assert.deepEqual(logged, [
      `Inquiry email failed for inquiry ${inquiry.id}: TypeError: fetch failed`,
      `Inquiry email failed for inquiry ${inquiry.id}: TypeError: fetch failed`,
    ]);
    for (const line of logged) {
      for (const secret of [API_KEY, 'rich@example.com', 'sam@example.com', 'Secret']) {
        assert.ok(!line.includes(secret));
      }
    }
  });
});
