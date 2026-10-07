// Boundary tests for the create post schema (validation/post.js), run through validate() so each
// case checks the same 400 envelope and field keys a request gets. The edit and status schemas
// share these fields and are covered by the request tests in api/siteOwner/index.test.js; these
// cover every limit in docs/endpoints.md (Validation rules).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('./validate');
const { createPostSchema } = require('./post');
const { ServerError } = require('../errors');

const IMAGE = { src: 'https://res.cloudinary.com/a.jpg', width: 800, height: 600, altText: 'A' };
const LINK = { name: 'Shop', url: 'https://shop.example.com' };

function createBody(overrides = {}) {
  return {
    websiteId: 'website-id',
    postName: 'Post',
    body: 'Body',
    images: [],
    links: [],
    ...overrides,
  };
}

// The `fields` of the 400 that validate() throws, or null when the input is valid.
function fieldErrors(schema, data) {
  try {
    validate(schema, data);
    return null;
  } catch (err) {
    assert.ok(err instanceof ServerError);
    assert.equal(err.status, 400);
    assert.equal(err.message, 'Please fix the highlighted fields.');
    return err.fields;
  }
}

describe('createPostSchema', () => {
  const textLimits = [
    ['postName', 100, 'Post name must be 100 characters or fewer.'],
    ['body', 5000, 'Body must be 5000 characters or fewer.'],
    ['header', 150, 'Header must be 150 characters or fewer.'],
    ['subHeader', 200, 'Sub header must be 200 characters or fewer.'],
  ];

  for (const [field, max, message] of textLimits) {
    it(`accepts ${field} at ${max} characters and rejects ${max + 1}`, () => {
      const atLimit = fieldErrors(createPostSchema, createBody({ [field]: 'a'.repeat(max) }));
      const overLimit = fieldErrors(createPostSchema, createBody({ [field]: 'a'.repeat(max + 1) }));

      assert.equal(atLimit, null);
      assert.deepEqual(overLimit, { [field]: message });
    });
  }

  it('requires websiteId, postName and body, trimming blanks to empty', () => {
    const fields = fieldErrors(
      createPostSchema,
      createBody({ websiteId: ' ', postName: '  ', body: undefined }),
    );

    assert.deepEqual(fields, {
      websiteId: 'Website is required.',
      postName: 'Post name is required.',
      body: 'Body is required.',
    });
  });

  it('trims text fields and turns blank optional fields into null', () => {
    const input = validate(
      createPostSchema,
      createBody({ postName: '  Post  ', header: '   ', subHeader: null, postDate: '' }),
    );

    assert.equal(input.postName, 'Post');
    assert.equal(input.header, null);
    assert.equal(input.subHeader, null);
    assert.equal(input.postDate, null);
  });

  it('defaults active to true when it is not sent', () => {
    const input = validate(createPostSchema, createBody());

    assert.equal(input.active, true);
  });

  it('rejects an active value that is not a boolean', () => {
    const fields = fieldErrors(createPostSchema, createBody({ active: 'yes' }));

    assert.deepEqual(fields, { active: 'Active must be true or false.' });
  });

  it('accepts a real date, including a leap day, and rejects an impossible one', () => {
    assert.equal(fieldErrors(createPostSchema, createBody({ postDate: '2028-02-29' })), null);
    assert.deepEqual(fieldErrors(createPostSchema, createBody({ postDate: '2027-02-29' })), {
      postDate: 'Enter a valid date (YYYY-MM-DD).',
    });
    assert.deepEqual(fieldErrors(createPostSchema, createBody({ postDate: '07/10/2026' })), {
      postDate: 'Enter a valid date (YYYY-MM-DD).',
    });
  });

  it('accepts 5 images and rejects 6 under the list name', () => {
    assert.equal(fieldErrors(createPostSchema, createBody({ images: Array(5).fill(IMAGE) })), null);
    assert.deepEqual(fieldErrors(createPostSchema, createBody({ images: Array(6).fill(IMAGE) })), {
      images: 'A post can have at most 5 images.',
    });
  });

  it('accepts 10 links and rejects 11 under the list name', () => {
    assert.equal(fieldErrors(createPostSchema, createBody({ links: Array(10).fill(LINK) })), null);
    assert.deepEqual(fieldErrors(createPostSchema, createBody({ links: Array(11).fill(LINK) })), {
      links: 'A post can have at most 10 links.',
    });
  });

  it('requires images and links to be lists', () => {
    const fields = fieldErrors(createPostSchema, createBody({ images: undefined, links: 'none' }));

    assert.deepEqual(fields, { images: 'Images must be a list.', links: 'Links must be a list.' });
  });

  for (const value of [1, 10000]) {
    it(`accepts an image width and height of ${value}`, () => {
      const image = { ...IMAGE, width: value, height: value };

      assert.equal(fieldErrors(createPostSchema, createBody({ images: [image] })), null);
    });
  }

  for (const value of [0, 10001, 1.5, '800']) {
    it(`rejects an image width and height of ${JSON.stringify(value)}`, () => {
      const image = { ...IMAGE, width: value, height: value };

      assert.deepEqual(fieldErrors(createPostSchema, createBody({ images: [image] })), {
        'images.0.width': 'Width must be a whole number between 1 and 10000.',
        'images.0.height': 'Height must be a whole number between 1 and 10000.',
      });
    });
  }

  it('accepts alt text at 200 characters and rejects 201', () => {
    const atLimit = { ...IMAGE, altText: 'a'.repeat(200) };
    const overLimit = { ...IMAGE, altText: 'a'.repeat(201) };

    assert.equal(fieldErrors(createPostSchema, createBody({ images: [atLimit] })), null);
    assert.deepEqual(fieldErrors(createPostSchema, createBody({ images: [IMAGE, overLimit] })), {
      'images.1.altText': 'Alt text must be 200 characters or fewer.',
    });
  });

  it('requires every image field', () => {
    const fields = fieldErrors(createPostSchema, createBody({ images: [{}] }));

    assert.deepEqual(fields, {
      'images.0.src': 'Image URL is required.',
      'images.0.width': 'Width must be a whole number between 1 and 10000.',
      'images.0.height': 'Height must be a whole number between 1 and 10000.',
      'images.0.altText': 'Alt text is required.',
    });
  });

  it('accepts a link name at 100 characters and rejects 101', () => {
    const atLimit = { ...LINK, name: 'a'.repeat(100) };
    const overLimit = { ...LINK, name: 'a'.repeat(101) };

    assert.equal(fieldErrors(createPostSchema, createBody({ links: [atLimit] })), null);
    assert.deepEqual(fieldErrors(createPostSchema, createBody({ links: [overLimit] })), {
      'links.0.name': 'Link name must be 100 characters or fewer.',
    });
  });

  it('requires https:// for image and link URLs', () => {
    const fields = fieldErrors(
      createPostSchema,
      createBody({
        images: [{ ...IMAGE, src: 'http://res.cloudinary.com/a.jpg' }],
        links: [{ name: 'Shop', url: 'ftp://shop.example.com' }, { name: 'Shop' }],
      }),
    );

    assert.deepEqual(fields, {
      'images.0.src': 'Must be a valid URL starting with https://',
      'links.0.url': 'Must be a valid URL starting with https://',
      'links.1.url': 'Link URL is required.',
    });
  });
});
