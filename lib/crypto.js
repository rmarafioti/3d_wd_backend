// The only place API keys and webhook secrets are generated, hashed, encrypted or decrypted
// (see docs/setup.md, Crypto Module). Used by Create an Account, Link a Website, requireApiKey
// and services/revalidate.js. Never log the plaintext values this module produces.
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // the recommended IV length for GCM

// SECRET_ENCRYPTION_KEY is 32 random bytes, base64-encoded in .env.
function encryptionKey() {
  const key = Buffer.from(process.env.SECRET_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) {
    throw new Error('SECRET_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  }
  return key;
}

function generateApiKey() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// SHA-256 hex digest. Stored in api_key_hash; the public endpoint hashes the incoming key
// the same way and looks it up, so the plaintext key is never stored.
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// AES-256-GCM with a fresh random IV. Stored as one string: base64(iv):base64(authTag):base64(ciphertext).
function encryptSecret(secret) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64')).join(':');
}

// Reverses encryptSecret. The auth tag check makes this throw if the stored value was tampered with.
function decryptSecret(stored) {
  const [iv, tag, ciphertext] = stored.split(':').map((part) => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  encryptSecret,
  decryptSecret,
};
