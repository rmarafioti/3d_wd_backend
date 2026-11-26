// Tests for validation/contact.js's websiteContactSchema: a client website's contact form, its
// limits, its extra fields and its photos, checked by their bytes.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { websiteContactSchema } = require('./contact');

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const GIF = Buffer.from('GIF89a');
const ONE_MB = 1024 * 1024;

function message(overrides = {}) {
  return { name: 'Sam', email: 'sam@example.com', ...overrides };
}

// A JPG of exactly `size` bytes.
function jpgOfSize(size) {
  return Buffer.concat([JPG, Buffer.alloc(size - JPG.length)]);
}

function image(bytes) {
  return { content: bytes.toString('base64') };
}

// The first issue's message keyed by its path, as validate() reports it.
function firstIssue(body) {
  const result = websiteContactSchema.safeParse(body);
  assert.equal(result.success, false);
  const [issue] = result.error.issues;
  return { [issue.path.join('.')]: issue.message };
}

describe('websiteContactSchema', () => {
  it('needs only a name and an email, giving a null message and no extras or images', () => {
    const result = websiteContactSchema.parse(message({ email: 'Sam@Example.com' }));

    assert.deepEqual(result, {
      name: 'Sam',
      email: 'sam@example.com',
      message: null,
      extras: [],
      images: [],
    });
  });

  it('requires the name and email with the shared messages', () => {
    assert.deepEqual(firstIssue({ email: 'sam@example.com' }), { name: 'Name is required.' });
    assert.deepEqual(firstIssue({ name: 'Sam', email: 'nope' }), {
      email: 'Enter a valid email address.',
    });
  });

  it('keeps a message of 5000 characters, line breaks included, and refuses 5001', () => {
    const text = `Hi\n${'a'.repeat(4997)}`;

    assert.equal(websiteContactSchema.parse(message({ message: text })).message, text);
    assert.deepEqual(firstIssue(message({ message: 'a'.repeat(5001) })), {
      message: 'Message must be 5000 characters or fewer.',
    });
  });

  it('keeps answered extras in order and drops the ones left blank', () => {
    const extras = [
      { label: 'Phone', value: ' 555-0100 ' },
      { label: "Dog's name", value: '  ' },
      { label: 'Service', value: 'Bath' },
    ];

    assert.deepEqual(websiteContactSchema.parse(message({ extras })).extras, [
      { label: 'Phone', value: '555-0100' },
      { label: 'Service', value: 'Bath' },
    ]);
  });

  it('allows 10 extras and refuses 11', () => {
    const extras = Array.from({ length: 10 }, (_, index) => ({ label: `Q${index}`, value: 'A' }));

    assert.equal(websiteContactSchema.parse(message({ extras })).extras.length, 10);
    assert.deepEqual(firstIssue(message({ extras: [...extras, { label: 'Q', value: 'A' }] })), {
      extras: 'A form can send at most 10 extra fields.',
    });
  });

  it("checks each extra's label and value on its own path", () => {
    assert.deepEqual(firstIssue(message({ extras: [{ label: ' ', value: 'A' }] })), {
      'extras.0.label': 'Label is required.',
    });
    assert.deepEqual(firstIssue(message({ extras: [{ label: 'a'.repeat(61), value: 'A' }] })), {
      'extras.0.label': 'Label must be 60 characters or fewer.',
    });
    assert.deepEqual(firstIssue(message({ extras: [{ label: 'Q', value: 'a'.repeat(1001) }] })), {
      'extras.0.value': 'Value must be 1000 characters or fewer.',
    });
    assert.deepEqual(firstIssue(message({ extras: 'Phone' })), {
      extras: 'Extras must be a list.',
    });
    assert.deepEqual(firstIssue(message({ extras: ['Phone'] })), {
      'extras.0': 'Each extra field needs a label and a value.',
    });
  });

  it('accepts a JPG, PNG and WebP, named by their type and kept as base64', () => {
    const result = websiteContactSchema.parse(
      message({ images: [image(JPG), image(PNG), image(WEBP)] }),
    );

    assert.deepEqual(result.images, [
      { filename: 'photo-1.jpg', content: JPG.toString('base64') },
      { filename: 'photo-2.png', content: PNG.toString('base64') },
      { filename: 'photo-3.webp', content: WEBP.toString('base64') },
    ]);
  });

  it('refuses a fourth image', () => {
    const images = [image(JPG), image(JPG), image(JPG), image(JPG)];

    assert.deepEqual(firstIssue(message({ images })), {
      images: 'A message can have at most 3 images.',
    });
  });

  it('refuses a GIF, text and data that is not base64, whatever it claims to be', () => {
    const notImage = { 'images.0.content': 'Each image must be a JPG, PNG or WebP.' };

    assert.deepEqual(firstIssue(message({ images: [image(GIF)] })), notImage);
    assert.deepEqual(firstIssue(message({ images: [image(Buffer.from('hello.jpg'))] })), notImage);
    assert.deepEqual(firstIssue(message({ images: [{ content: 'not base64!' }] })), notImage);
    assert.deepEqual(firstIssue(message({ images: [{ content: 42 }] })), notImage);
  });

  it('accepts an image of exactly 1 MB and refuses one byte more', () => {
    assert.equal(
      websiteContactSchema.parse(message({ images: [image(jpgOfSize(ONE_MB))] })).images.length,
      1,
    );
    assert.deepEqual(firstIssue(message({ images: [image(jpgOfSize(ONE_MB + 1))] })), {
      'images.0.content': 'Each image must be 1 MB or smaller.',
    });
  });

  it('never takes a file name from the request', () => {
    const result = websiteContactSchema.parse(
      message({ images: [{ content: JPG.toString('base64'), filename: '../../evil.exe' }] }),
    );

    assert.equal(result.images[0].filename, 'photo-1.jpg');
  });
});
