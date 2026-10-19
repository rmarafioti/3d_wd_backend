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
const PARAGRAPH = { type: 'paragraph', text: 'Body' };

function imageElement(image = IMAGE) {
  return { type: 'image', image };
}

function createBody(overrides = {}) {
  return {
    websiteId: 'website-id',
    postName: 'Post',
    body: [PARAGRAPH],
    ...overrides,
  };
}

// A body of one paragraph followed by the given image elements, so image field keys start at
// body.1.
function bodyWithImages(...images) {
  return createBody({ body: [PARAGRAPH, ...images.map(imageElement)] });
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
      body: 'Body must be a list.',
    });
  });

  it('accepts a paragraph at 10000 characters and rejects 10001', () => {
    const atLimit = { type: 'paragraph', text: 'a'.repeat(10000) };
    const overLimit = { type: 'paragraph', text: 'a'.repeat(10001) };

    assert.equal(fieldErrors(createPostSchema, createBody({ body: [atLimit] })), null);
    assert.deepEqual(fieldErrors(createPostSchema, createBody({ body: [PARAGRAPH, overLimit] })), {
      'body.1.text': 'Paragraph must be 10000 characters or fewer.',
    });
  });

  it('trims a paragraph at the ends but keeps its line breaks', () => {
    const text = '  First line.\nSecond line.\n\nNew thought.  ';

    const input = validate(createPostSchema, createBody({ body: [{ type: 'paragraph', text }] }));

    assert.equal(input.body[0].text, 'First line.\nSecond line.\n\nNew thought.');
  });

  it('requires paragraph text, treating a blank paragraph as empty', () => {
    const fields = fieldErrors(
      createPostSchema,
      createBody({ body: [PARAGRAPH, { type: 'paragraph', text: '   ' }] }),
    );

    assert.deepEqual(fields, { 'body.1.text': 'Paragraph is required.' });
  });

  it('requires at least one paragraph, even when the body has images', () => {
    assert.deepEqual(fieldErrors(createPostSchema, createBody({ body: [] })), {
      body: 'Add at least one paragraph.',
    });
    assert.deepEqual(fieldErrors(createPostSchema, createBody({ body: [imageElement()] })), {
      body: 'Add at least one paragraph.',
    });
  });

  it('accepts 5 paragraphs and rejects 6 under the list name', () => {
    assert.equal(
      fieldErrors(createPostSchema, createBody({ body: Array(5).fill(PARAGRAPH) })),
      null,
    );
    assert.deepEqual(
      fieldErrors(createPostSchema, createBody({ body: Array(6).fill(PARAGRAPH) })),
      {
        body: 'A post can have at most 5 paragraphs.',
      },
    );
  });

  it('rejects an element whose type is not paragraph or image', () => {
    const fields = fieldErrors(
      createPostSchema,
      createBody({ body: [PARAGRAPH, { type: 'video', text: 'Body' }, { text: 'Body' }] }),
    );

    assert.deepEqual(fields, {
      'body.1.type': 'Element type must be paragraph or image.',
      'body.2.type': 'Element type must be paragraph or image.',
    });
  });

  it('requires an image element to carry an image', () => {
    const fields = fieldErrors(
      createPostSchema,
      createBody({ body: [PARAGRAPH, { type: 'image' }] }),
    );

    assert.deepEqual(fields, { 'body.1.image': 'Image is required.' });
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
    assert.equal(fieldErrors(createPostSchema, bodyWithImages(...Array(5).fill(IMAGE))), null);
    assert.deepEqual(fieldErrors(createPostSchema, bodyWithImages(...Array(6).fill(IMAGE))), {
      body: 'A post can have at most 5 images.',
    });
  });

  it('requires body to be a list', () => {
    const fields = fieldErrors(createPostSchema, createBody({ body: 'Body' }));

    assert.deepEqual(fields, { body: 'Body must be a list.' });
  });

  for (const value of [1, 10000]) {
    it(`accepts an image width and height of ${value}`, () => {
      const image = { ...IMAGE, width: value, height: value };

      assert.equal(fieldErrors(createPostSchema, bodyWithImages(image)), null);
    });
  }

  for (const value of [0, 10001, 1.5, '800']) {
    it(`rejects an image width and height of ${JSON.stringify(value)}`, () => {
      const image = { ...IMAGE, width: value, height: value };

      assert.deepEqual(fieldErrors(createPostSchema, bodyWithImages(image)), {
        'body.1.image.width': 'Width must be a whole number between 1 and 10000.',
        'body.1.image.height': 'Height must be a whole number between 1 and 10000.',
      });
    });
  }

  it('accepts alt text at 200 characters and rejects 201', () => {
    const atLimit = { ...IMAGE, altText: 'a'.repeat(200) };
    const overLimit = { ...IMAGE, altText: 'a'.repeat(201) };

    assert.equal(fieldErrors(createPostSchema, bodyWithImages(atLimit)), null);
    assert.deepEqual(fieldErrors(createPostSchema, bodyWithImages(IMAGE, overLimit)), {
      'body.2.image.altText': 'Alt text must be 200 characters or fewer.',
    });
  });

  it('requires every image field', () => {
    const fields = fieldErrors(createPostSchema, bodyWithImages({}));

    assert.deepEqual(fields, {
      'body.1.image.src': 'Image URL is required.',
      'body.1.image.width': 'Width must be a whole number between 1 and 10000.',
      'body.1.image.height': 'Height must be a whole number between 1 and 10000.',
      'body.1.image.altText': 'Alt text is required.',
    });
  });

  it('requires https:// for image URLs', () => {
    const image = { ...IMAGE, src: 'http://res.cloudinary.com/a.jpg' };

    assert.deepEqual(fieldErrors(createPostSchema, bodyWithImages(image)), {
      'body.1.image.src': 'Must be a valid URL starting with https://',
    });
  });
});

// Links inside paragraph text, checked against the examples in docs/endpoints.md → Paragraph
// formatting. Rendering is not the backend's job; only which text is accepted.
describe('createPostSchema paragraph links', () => {
  function paragraphErrors(text) {
    return fieldErrors(createPostSchema, createBody({ body: [{ type: 'paragraph', text }] }));
  }

  const URL_MESSAGE = 'Each link must be a valid URL starting with https://';

  const rejected = [
    ['[menu](http://example.com)', URL_MESSAGE],
    ['[menu](javascript:alert(1))', URL_MESSAGE],
    ['[ ](https://example.com)', 'Each link needs link text.'],
    [`[${'a'.repeat(101)}](https://example.com)`, 'Link text must be 100 characters or fewer.'],
  ];

  for (const [text, message] of rejected) {
    it(`rejects ${JSON.stringify(text.slice(0, 40))} on body.0.text`, () => {
      assert.deepEqual(paragraphErrors(text), { 'body.0.text': message });
    });
  }

  const accepted = [
    'See [our menu](https://example.com/menu).',
    '**Bold** and *italic* and [a link](https://example.com)',
    `[${'a'.repeat(100)}](https://example.com)`,
    '[no url]',
    '[menu] (https://example.com)',
    '[menu](https://example.com and more)',
    '5 * 3 * 2',
    '[**Menu**](https://example.com)',
    '<b>hi</b> & more',
  ];

  for (const text of accepted) {
    it(`accepts ${JSON.stringify(text.slice(0, 40))}`, () => {
      assert.equal(paragraphErrors(text), null);
    });
  }

  it('reports the first failing link in the text', () => {
    const text = '[ok](https://example.com) [bad](http://example.com) [ ](https://example.com)';

    assert.deepEqual(paragraphErrors(text), { 'body.0.text': URL_MESSAGE });
  });

  // A regex re-scanning from every unmatched [ took ~770ms here and blocked the server.
  for (const unit of ['[', '[a](']) {
    it(`checks five paragraphs of repeated ${JSON.stringify(unit)} in under 50ms`, () => {
      const text = unit.repeat(10000 / unit.length);
      const body = Array(5).fill({ type: 'paragraph', text });

      const start = performance.now();
      fieldErrors(createPostSchema, createBody({ body }));

      assert.ok(performance.now() - start < 50);
    });
  }

  it("checks a link's text before its URL", () => {
    assert.deepEqual(paragraphErrors('[ ](http://example.com)'), {
      'body.0.text': 'Each link needs link text.',
    });
  });
});
