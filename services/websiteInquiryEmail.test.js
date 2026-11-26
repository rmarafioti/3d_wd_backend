// Tests for services/websiteInquiryEmail.js: the email to a website's active site owners with the
// photos attached, nothing sent without a site owner or a key, and failures logged by id only.
require('../testing/setup');
const { describe, it, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../prisma');
const sendWebsiteInquiryEmail = require('./websiteInquiryEmail');
const {
  resetState,
  disconnect,
  createAdmin,
  createSiteOwner,
  createWebsite,
  linkWebsite,
  mockFetch,
} = require('../testing/helpers');

const API_KEY = 're_test_key';
const PHOTO = {
  filename: 'photo-1.jpg',
  content: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
};

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

// A website named Good Boys with one active site owner, the address the email goes to.
async function createOwnedWebsite() {
  const owner = await createSiteOwner({ email: 'owner@example.com' });
  const { website } = await createWebsite({ websiteName: 'Good Boys' });
  await linkWebsite(owner, website);
  return website;
}

function createInquiry(website, overrides = {}) {
  return prisma.websiteInquiry.create({
    data: {
      websiteId: website.id,
      name: 'Sam Rivera',
      email: 'sam@example.com',
      message: 'Can I book a bath?\nThanks.',
      ...overrides,
    },
  });
}

function sentBodies() {
  return fetchMock.mock.calls.map((call) => JSON.parse(call.arguments[1].body));
}

describe('sendWebsiteInquiryEmail', () => {
  it("emails the website's site owners with Reply-To the visitor, the extras and the photos", async () => {
    const website = await createOwnedWebsite();
    const inquiry = await createInquiry(website, {
      extras: [
        { label: 'Phone', value: '555-0100' },
        { label: "Dog's name", value: 'Stevie' },
      ],
      imageCount: 1,
    });

    await sendWebsiteInquiryEmail(inquiry.id, [PHOTO]);

    assert.deepEqual(sentBodies(), [
      {
        from: '3D Web Dev <notifications@3dwebdev.com>',
        to: ['owner@example.com'],
        reply_to: 'sam@example.com',
        subject: 'New message from Good Boys: Sam Rivera',
        text: [
          'Name: Sam Rivera',
          'Email: sam@example.com',
          'Phone: 555-0100',
          "Dog's name: Stevie",
          '',
          'Message:',
          'Can I book a bath?',
          'Thanks.',
          '',
          'Photos attached: 1',
          '',
          'Reply to this email to answer Sam Rivera.',
          '',
        ].join('\n'),
        attachments: [PHOTO],
      },
    ]);
  });

  it('leaves out the message, photos and attachments when the form sent none', async () => {
    const website = await createOwnedWebsite();
    const inquiry = await createInquiry(website, { message: null });

    await sendWebsiteInquiryEmail(inquiry.id, []);

    const [body] = sentBodies();
    assert.equal(
      body.text,
      [
        'Name: Sam Rivera',
        'Email: sam@example.com',
        '',
        'Reply to this email to answer Sam Rivera.',
        '',
      ].join('\n'),
    );
    assert.equal('attachments' in body, false);
  });

  it("sends only to this website's active site owners, never an admin or another website's owner", async () => {
    const website = await createOwnedWebsite();
    const second = await createSiteOwner({ email: 'second@example.com' });
    await linkWebsite(second, website);
    const inactive = await createSiteOwner({ email: 'gone@example.com', active: false });
    await linkWebsite(inactive, website);
    const admin = await createAdmin({ email: 'rich@example.com' });
    await linkWebsite(admin, website);
    const other = await createSiteOwner({ email: 'other@example.com' });
    const { website: otherWebsite } = await createWebsite();
    await linkWebsite(other, otherWebsite);
    const inquiry = await createInquiry(website);

    await sendWebsiteInquiryEmail(inquiry.id, []);

    assert.deepEqual(sentBodies()[0].to.sort(), ['owner@example.com', 'second@example.com']);
  });

  it('sends nothing when the website has no active site owner', async () => {
    const { website } = await createWebsite();
    const inquiry = await createInquiry(website);

    await sendWebsiteInquiryEmail(inquiry.id, []);

    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('sends nothing when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const website = await createOwnedWebsite();
    const inquiry = await createInquiry(website);

    await sendWebsiteInquiryEmail(inquiry.id, []);

    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('keeps the subject to one line when the name holds a line break', async () => {
    const website = await createOwnedWebsite();
    const inquiry = await createInquiry(website, { name: 'Sam\r\nBcc: someone@example.com' });

    await sendWebsiteInquiryEmail(inquiry.id, []);

    assert.equal(
      sentBodies()[0].subject,
      'New message from Good Boys: Sam Bcc: someone@example.com',
    );
  });

  it('logs a refused email with the inquiry id only, and never rejects', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    const website = await createOwnedWebsite();
    const inquiry = await createInquiry(website, { name: 'Secret Name', message: 'Secret text' });
    fetchMock.mock.mockImplementation(async () => new Response(null, { status: 422 }));

    const result = await sendWebsiteInquiryEmail(inquiry.id, [PHOTO]);

    assert.equal(result, undefined);
    const logged = errors.mock.calls.map((call) => call.arguments.join(' '));
    assert.deepEqual(logged, [`Website inquiry email failed for inquiry ${inquiry.id}: HTTP 422`]);
  });

  it('logs a network failure without the key, an address, a name, the message or a photo', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    const website = await createOwnedWebsite();
    const inquiry = await createInquiry(website, { name: 'Secret Name', message: 'Secret text' });
    fetchMock.mock.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });

    await sendWebsiteInquiryEmail(inquiry.id, [PHOTO]);

    const logged = errors.mock.calls.map((call) => call.arguments.join(' '));
    assert.deepEqual(logged, [
      `Website inquiry email failed for inquiry ${inquiry.id}: TypeError: fetch failed`,
    ]);
    for (const secret of [
      API_KEY,
      'owner@example.com',
      'sam@example.com',
      'Secret',
      PHOTO.content,
    ]) {
      assert.ok(!logged[0].includes(secret));
    }
  });
});
