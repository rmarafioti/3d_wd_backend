// Request tests for the contact form route (api/contact/index.js): saving an inquiry with its audit
// event, validation, the CSRF header, the honeypot, the rate limit and a failed email.
require('../../testing/setup');
const { describe, it, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../app');
const prisma = require('../../prisma');
const {
  CSRF,
  resetState,
  disconnect,
  createAdmin,
  auditEvents,
  mockFetch,
  waitFor,
} = require('../../testing/helpers');

const RECEIVED = { data: { received: true } };

let fetchMock;

beforeEach(async () => {
  await resetState();
  fetchMock = mockFetch(mock);
});
afterEach(() => {
  delete process.env.RESEND_API_KEY;
  mock.restoreAll();
});
after(disconnect);

function validInquiry(overrides = {}) {
  return {
    name: 'Sam Rivera',
    business: 'Rivera Tattoo',
    email: 'Sam@Example.com',
    startingPoint: 'unfinished_website',
    goal: 'Take bookings.\nShow my portfolio.',
    ...overrides,
  };
}

function sendInquiry(body = validInquiry()) {
  return request(app).post('/api/contact').set(CSRF).send(body);
}

function inquiries() {
  return prisma.inquiry.findMany({
    select: { id: true, name: true, business: true, email: true, startingPoint: true, goal: true },
  });
}

// The 400 envelope with one field's message.
function fieldError(field, message) {
  return {
    error: { message: 'Please fix the highlighted fields.', fields: { [field]: message } },
  };
}

describe('POST /api/contact', () => {
  it('saves the inquiry, email lowercased, and records it in the audit log with no actor', async () => {
    const res = await sendInquiry();

    assert.equal(res.status, 201);
    assert.deepEqual(res.body, RECEIVED);
    const [inquiry] = await inquiries();
    assert.deepEqual(inquiry, {
      id: inquiry.id,
      name: 'Sam Rivera',
      business: 'Rivera Tattoo',
      email: 'sam@example.com',
      startingPoint: 'unfinished_website',
      goal: 'Take bookings.\nShow my portfolio.',
    });
    assert.deepEqual(await auditEvents(), [
      {
        action: 'inquiry.received',
        actorId: null,
        actorEmail: null,
        targetType: 'inquiry',
        targetId: inquiry.id,
        metadata: null,
      },
    ]);
  });

  it('accepts a request with an invalid session cookie, never answering 401', async () => {
    const res = await request(app)
      .post('/api/contact')
      .set(CSRF)
      .set('Cookie', 'session=not-a-jwt')
      .send(validInquiry());

    assert.equal(res.status, 201);
    assert.equal((await inquiries()).length, 1);
  });

  it('returns 403 without the CSRF header and saves nothing', async () => {
    const res = await request(app).post('/api/contact').send(validInquiry());

    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: { message: 'Request blocked.' } });
    assert.equal((await inquiries()).length, 0);
  });

  it('answers 201 to a filled honeypot without validating, saving or sending', async () => {
    process.env.RESEND_API_KEY = 're_test_key';

    const res = await sendInquiry({ contactCode: 'bot', email: 'not-an-email' });

    assert.equal(res.status, 201);
    assert.deepEqual(res.body, RECEIVED);
    assert.equal((await inquiries()).length, 0);
    assert.deepEqual(await auditEvents(), []);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('saves the inquiry when the honeypot is sent blank', async () => {
    const res = await sendInquiry(validInquiry({ contactCode: '   ' }));

    assert.equal(res.status, 201);
    assert.equal((await inquiries()).length, 1);
  });

  it('returns 400 with every missing field named', async () => {
    const res = await sendInquiry({ name: '   ' });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        message: 'Please fix the highlighted fields.',
        fields: {
          name: 'Name is required.',
          business: 'Business name is required.',
          email: 'Email is required.',
          startingPoint: "Choose where you're starting from.",
          goal: 'Tell me what you want your site to do.',
        },
      },
    });
    assert.equal((await inquiries()).length, 0);
  });

  it('returns 400 for a name or business over 100 characters', async () => {
    const name = await sendInquiry(validInquiry({ name: 'a'.repeat(101) }));
    const business = await sendInquiry(validInquiry({ business: 'a'.repeat(101) }));

    assert.deepEqual(name.body, fieldError('name', 'Name must be 100 characters or fewer.'));
    assert.deepEqual(
      business.body,
      fieldError('business', 'Business name must be 100 characters or fewer.'),
    );
  });

  it('accepts a goal of 2000 characters and refuses one of 2001', async () => {
    const atLimit = await sendInquiry(validInquiry({ goal: 'a'.repeat(2000) }));
    const overLimit = await sendInquiry(validInquiry({ goal: 'a'.repeat(2001) }));

    assert.equal(atLimit.status, 201);
    assert.deepEqual(
      overLimit.body,
      fieldError('goal', 'Your answer must be 2000 characters or fewer.'),
    );
  });

  it('returns 400 for an invalid email or an unknown starting point', async () => {
    const email = await sendInquiry(validInquiry({ email: 'sam@' }));
    const startingPoint = await sendInquiry(
      validInquiry({ startingPoint: "I don't have a website yet" }),
    );

    assert.deepEqual(email.body, fieldError('email', 'Enter a valid email address.'));
    assert.deepEqual(
      startingPoint.body,
      fieldError('startingPoint', "Choose where you're starting from."),
    );
  });

  it('returns 429 on the sixth request in an hour', async () => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await sendInquiry()).status, 201);
    }

    const res = await sendInquiry();

    assert.equal(res.status, 429);
    assert.deepEqual(res.body, {
      error: { message: 'Too many requests. Please try again later.' },
    });
    assert.equal((await inquiries()).length, 5);
  });

  it('still answers 201 with the inquiry saved when Resend fails', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    process.env.RESEND_API_KEY = 're_test_key';
    await createAdmin();
    fetchMock.mock.mockImplementation(async () => new Response(null, { status: 500 }));

    const res = await sendInquiry();

    assert.equal(res.status, 201);
    assert.equal((await inquiries()).length, 1);
    await waitFor(() => assert.equal(errors.mock.callCount(), 2));
  });
});
