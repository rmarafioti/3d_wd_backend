// Tests for API key and webhook secret handling (lib/crypto.js): generation, hashing, and the
// AES-256-GCM encrypt / decrypt round trip.
require('../testing/setup');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  encryptSecret,
  decryptSecret,
} = require('./crypto');

describe('generateApiKey and generateWebhookSecret', () => {
  it('return 32 random bytes as a 43-character base64url string, different every time', () => {
    const values = [generateApiKey(), generateApiKey(), generateWebhookSecret()];

    for (const value of values) assert.match(value, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(new Set(values).size, values.length);
  });
});

describe('hashApiKey', () => {
  it('returns the SHA-256 hex digest', () => {
    assert.equal(
      hashApiKey('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('encryptSecret and decryptSecret', () => {
  it('round-trips a secret through the stored "iv:tag:ciphertext" form', () => {
    const secret = generateWebhookSecret();

    const stored = encryptSecret(secret);

    assert.equal(stored.split(':').length, 3);
    assert.ok(!stored.includes(secret));
    assert.equal(decryptSecret(stored), secret);
  });

  it('encrypts the same secret differently each time', () => {
    assert.notEqual(encryptSecret('secret'), encryptSecret('secret'));
  });

  it('throws when the stored value was tampered with', () => {
    const [iv, tag, ciphertext] = encryptSecret('secret').split(':');
    const flipped = Buffer.from(ciphertext, 'base64');
    flipped[0] ^= 1;

    assert.throws(() => decryptSecret([iv, tag, flipped.toString('base64')].join(':')));
  });

  it('throws when SECRET_ENCRYPTION_KEY is not 32 bytes', (t) => {
    const original = process.env.SECRET_ENCRYPTION_KEY;
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    t.after(() => {
      process.env.SECRET_ENCRYPTION_KEY = original;
    });

    assert.throws(() => encryptSecret('secret'), /must be 32 bytes/);
  });
});
