// Tests for services/requestEmail.js, the admin's email when a site owner sends or edits a request
// message. The route tests prove it is sent after each request route; these cover what the routes
// can't reach easily: the Resend call itself, its plain-text content, the recipients read from the
// database, nothing sent without a key, and a failure logged with the
// website id only and never rejecting. fetch is mocked in every test.
require('../testing/setup');
const { describe, it, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../prisma');
const sendRequestEmail = require('./requestEmail');
const {
  resetState,
  disconnect,
  createAdmin,
  createOwnerWithWebsite,
  createAbility,
  createGallery,
  mockFetch,
} = require('../testing/helpers');

const API_KEY = 're_test_key';

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

// A site owner's website whose posts were requested, with the note on where they go.
async function postsRequest(note = 'On the News page') {
  const { owner, website } = await createOwnerWithWebsite({ websiteName: 'Stevie The Dog' });
  const ability = await createAbility(website, 'posts', {
    placement: 'requested',
    requestNote: note,
    requestedAt: new Date(),
  });
  return { owner, website, ability };
}

// The URL, headers and parsed body of the n-th call sent to fetch.
function sentEmail(n = 0) {
  const [url, options] = fetchMock.mock.calls[n].arguments;
  return { url, headers: options.headers, body: JSON.parse(options.body) };
}

describe('sendRequestEmail', () => {
  it('sends the posts request to every active admin, replying to the site owner', async () => {
    await createAdmin({ email: 'rich@example.com' });
    await createAdmin({ email: 'gone@example.com', active: false });
    const { owner, website, ability } = await postsRequest();

    await sendRequestEmail(website.id, { siteOwnerId: owner.id, abilityId: ability.id });

    const { url, headers, body } = sentEmail();
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(headers.Authorization, `Bearer ${API_KEY}`);
    assert.deepEqual(body, {
      from: '3D Web Dev <notifications@3dwebdev.com>',
      to: ['rich@example.com'],
      reply_to: owner.email,
      subject: 'New request: Posts on Stevie The Dog',
      text: [
        'Site Owner has requested Posts on Stevie The Dog.',
        '',
        'Where it should go:',
        'On the News page',
        '',
        'Reply to this email to send Site Owner the mock-up.',
        'https://3dwebdev.com/admin',
        '',
      ].join('\n'),
    });
    assert.ok(!JSON.stringify(body).includes(website.id));
  });

  it('names the gallery and says the site owner changed where it goes on an edit', async () => {
    await createAdmin();
    const { owner, website } = await createOwnerWithWebsite({ websiteName: 'Stevie The Dog' });
    const gallery = await createGallery(website, {
      galleryName: 'Our Interior',
      requestNote: 'On the Portfolio page',
      requestedAt: new Date(),
    });

    await sendRequestEmail(website.id, {
      siteOwnerId: owner.id,
      galleryId: gallery.id,
      isUpdate: true,
    });

    const { body } = sentEmail();
    assert.equal(body.subject, 'Updated request: Photo Galleries "Our Interior" on Stevie The Dog');
    assert.match(
      body.text,
      /^Site Owner has changed where Photo Galleries "Our Interior" should go on Stevie The Dog\./,
    );
    assert.match(body.text, /On the Portfolio page/);
  });

  it('keeps the subject to one line when a name holds a line break', async () => {
    await createAdmin();
    const { owner, website, ability } = await postsRequest();
    await prisma.website.update({
      where: { id: website.id },
      data: { websiteName: 'Stevie\r\nBcc: someone@example.com' },
    });

    await sendRequestEmail(website.id, { siteOwnerId: owner.id, abilityId: ability.id });

    assert.equal(sentEmail().body.subject, 'New request: Posts on Stevie Bcc: someone@example.com');
  });

  it('sends nothing when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    await createAdmin();
    const { owner, website, ability } = await postsRequest();

    await sendRequestEmail(website.id, { siteOwnerId: owner.id, abilityId: ability.id });

    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('logs a failed send with the website id only, and never rejects', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    await createAdmin({ email: 'rich@example.com' });
    const { owner, website, ability } = await postsRequest('Secret place');

    fetchMock.mock.mockImplementationOnce(async () => new Response(null, { status: 422 }));
    fetchMock.mock.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed');
    }, 1);

    const results = [];
    for (let i = 0; i < 2; i += 1) {
      results.push(
        await sendRequestEmail(website.id, { siteOwnerId: owner.id, abilityId: ability.id }),
      );
    }

    assert.deepEqual(results, [undefined, undefined]);
    const logged = errors.mock.calls.map((call) => call.arguments.join(' '));
    assert.deepEqual(logged, [
      `Request email failed for website ${website.id}: HTTP 422`,
      `Request email failed for website ${website.id}: TypeError: fetch failed`,
    ]);
    for (const line of logged) {
      for (const secret of [API_KEY, 'rich@example.com', owner.email, 'Secret place']) {
        assert.ok(!line.includes(secret));
      }
    }
  });
});
