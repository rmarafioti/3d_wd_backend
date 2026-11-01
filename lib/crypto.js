// The only place API keys, webhook secrets and backup keys are generated, hashed, encrypted or
// decrypted (see docs/setup.md, Crypto Module). Used by Create an Account, Link a Website,
// requireApiKey, services/revalidate.js, and the database backup and its scripts.
// Never log the plaintext values this module produces.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // the recommended IV length for GCM
const TAG_BYTES = 16; // GCM's auth tag

// An encrypted backup file:
// magic | wrapped key length (uint16) | wrapped key | IV | ciphertext | tag.
const BACKUP_MAGIC = Buffer.from('3DWDBK01');
const BACKUP_KEY_BITS = 4096;
const OAEP = { padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };

// SECRET_ENCRYPTION_KEY is 32 random bytes, base64-encoded in .env. Throws on any other length;
// lib/config.js calls it with the env value so a bad key stops the server at startup.
function encryptionKey(encoded = process.env.SECRET_ENCRYPTION_KEY) {
  const key = Buffer.from(encoded ?? '', 'base64');
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

// AES-256-GCM with a fresh random IV. Stored as one string:
// base64(iv):base64(authTag):base64(ciphertext).
function encryptSecret(secret) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64')).join(':');
}

// Reverses encryptSecret. The auth tag check makes this throw if the stored value was tampered
// with.
function decryptSecret(stored) {
  const [iv, tag, ciphertext] = stored.split(':').map((part) => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// The backup key pair (docs/deploy.md → Render services): the public key encrypts every dump
// and is the only half Render holds; the private key lives only in 1Password.
function generateBackupKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: BACKUP_KEY_BITS,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

// BACKUP_PUBLIC_KEY is the public key's PEM, base64-encoded onto one line for Render. Throws
// unless it is an RSA public key of at least 4096 bits. A private key is refused too: Node would
// accept one and derive its public half, but the private key must never sit in Render.
function backupPublicKey(encoded = process.env.BACKUP_PUBLIC_KEY) {
  const invalid = new Error(
    'BACKUP_PUBLIC_KEY must be an RSA public key of at least 4096 bits, PEM base64-encoded.',
  );
  const pem = Buffer.from(encoded ?? '', 'base64').toString('utf8');
  if (!pem.includes('-----BEGIN PUBLIC KEY-----')) throw invalid;
  let key;
  try {
    key = crypto.createPublicKey(pem);
  } catch {
    throw invalid;
  }
  const isStrongRsa =
    key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails.modulusLength >= BACKUP_KEY_BITS;
  if (!isStrongRsa) throw invalid;
  return key;
}

// A stream that encrypts a database dump. Each dump gets its own random AES-256-GCM key, wrapped
// with the backup public key (RSA-OAEP, SHA-256), so only the private key can read it. The tag is
// written last because GCM only knows it once the whole dump has passed through.
function createBackupEncryptor(publicKey) {
  const dataKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(IV_BYTES);
  const wrappedKey = crypto.publicEncrypt({ key: publicKey, ...OAEP }, dataKey);
  const wrappedKeyLength = Buffer.alloc(2);
  wrappedKeyLength.writeUInt16BE(wrappedKey.length);
  const cipher = crypto.createCipheriv(ALGORITHM, dataKey, iv);

  const encryptor = new Transform({
    transform(chunk, encoding, done) {
      done(null, cipher.update(chunk));
    },
    flush(done) {
      this.push(cipher.final());
      done(null, cipher.getAuthTag());
    },
  });
  encryptor.push(Buffer.concat([BACKUP_MAGIC, wrappedKeyLength, wrappedKey, iv]));
  return encryptor;
}

// Reverses createBackupEncryptor: reads the file at filePath and writes the dump to `output`.
// Rejects on a wrong key, a file that isn't a backup, or any changed byte. By then part of the
// dump may already be in `output`, so the caller treats `output` as usable only once this resolves.
async function decryptBackup(filePath, privateKeyPem, output) {
  const handle = await fs.promises.open(filePath, 'r');
  let wrappedKey, iv, tag, ciphertextStart, size;
  try {
    ({ size } = await handle.stat());
    const start = Buffer.alloc(BACKUP_MAGIC.length + 2);
    await handle.read(start, 0, start.length, 0);
    if (!start.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
      throw new Error('Not a 3DWD backup file.');
    }
    wrappedKey = Buffer.alloc(start.readUInt16BE(BACKUP_MAGIC.length));
    await handle.read(wrappedKey, 0, wrappedKey.length, start.length);
    iv = Buffer.alloc(IV_BYTES);
    await handle.read(iv, 0, IV_BYTES, start.length + wrappedKey.length);
    ciphertextStart = start.length + wrappedKey.length + IV_BYTES;
    if (size <= ciphertextStart + TAG_BYTES) throw new Error('The backup file is incomplete.');
    tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }

  const dataKey = crypto.privateDecrypt({ key: privateKeyPem, ...OAEP }, wrappedKey);
  const decipher = crypto.createDecipheriv(ALGORITHM, dataKey, iv);
  decipher.setAuthTag(tag);
  const ciphertext = fs.createReadStream(filePath, {
    start: ciphertextStart,
    end: size - TAG_BYTES - 1, // inclusive
  });
  await pipeline(ciphertext, decipher, output);
}

module.exports = {
  encryptionKey,
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  encryptSecret,
  decryptSecret,
  generateBackupKeyPair,
  backupPublicKey,
  createBackupEncryptor,
  decryptBackup,
};
