// Boundary tests for the Create an Account schema (validation/account.js), which includes the
// website choice from validation/website.js. Link a Website's websiteChoiceSchema is built from
// the same shape and refine, so these cases cover it too.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('./validate');
const { createAccountSchema } = require('./account');

function accountBody(overrides = {}) {
  return { name: 'Rich', email: 'rich@example.com', websiteId: 'website-id', ...overrides };
}

// The `fields` of the 400 that validate() throws, or null when the input is valid.
function fieldErrors(data) {
  try {
    validate(createAccountSchema, data);
    return null;
  } catch (err) {
    assert.equal(err.status, 400);
    return err.fields;
  }
}

describe('createAccountSchema', () => {
  it('accepts a name at 100 characters and rejects 101', () => {
    assert.equal(fieldErrors(accountBody({ name: 'a'.repeat(100) })), null);
    assert.deepEqual(fieldErrors(accountBody({ name: 'a'.repeat(101) })), {
      name: 'Name must be 100 characters or fewer.',
    });
  });

  it('requires a name and an email', () => {
    const fields = fieldErrors(accountBody({ name: '  ', email: undefined }));

    assert.deepEqual(fields, { name: 'Name is required.', email: 'Email is required.' });
  });

  it('rejects an invalid email', () => {
    assert.deepEqual(fieldErrors(accountBody({ email: 'rich@' })), {
      email: 'Enter a valid email address.',
    });
  });

  it('requires one website choice', () => {
    assert.deepEqual(fieldErrors(accountBody({ websiteId: '' })), {
      websiteId: 'Select a website or enter a new one.',
    });
  });

  it('rejects both website choices at once', () => {
    assert.deepEqual(fieldErrors(accountBody({ websiteName: 'Stevie' })), {
      websiteId: 'Select an existing website or enter a new one, not both.',
    });
  });

  it('requires both the name and the URL of a new website', () => {
    assert.deepEqual(fieldErrors(accountBody({ websiteId: undefined, websiteName: 'Stevie' })), {
      websiteUrl: 'Website URL is required.',
    });
    assert.deepEqual(
      fieldErrors(accountBody({ websiteId: undefined, websiteUrl: 'https://stevie.com' })),
      { websiteName: 'Website name is required.' },
    );
  });

  it('accepts a website name at 100 characters and rejects 101', () => {
    const newWebsite = { websiteId: undefined, websiteUrl: 'https://stevie.com' };

    assert.equal(fieldErrors(accountBody({ ...newWebsite, websiteName: 'a'.repeat(100) })), null);
    assert.deepEqual(fieldErrors(accountBody({ ...newWebsite, websiteName: 'a'.repeat(101) })), {
      websiteName: 'Website name must be 100 characters or fewer.',
    });
  });

  it('requires the website URL to start with https://', () => {
    const fields = fieldErrors(
      accountBody({ websiteId: undefined, websiteName: 'Stevie', websiteUrl: 'http://stevie.com' }),
    );

    assert.deepEqual(fields, { websiteUrl: 'Must be a valid URL starting with https://' });
  });
});
