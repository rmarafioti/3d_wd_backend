// Tests for lib/crypto.js: API key and webhook secret generation, hashing and the AES-256-GCM
// encrypt / decrypt round trip, and the backup key pair and encrypted dump format.
require('../testing/setup');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable, PassThrough } = require('stream');
const { pipeline } = require('stream/promises');
const {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  encryptSecret,
  decryptSecret,
  generateBackupKeyPair,
  backupPublicKey,
  createBackupEncryptor,
  decryptBackup,
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

describe('backup encryption', () => {
  let keys;
  let tempDir;

  before(() => {
    keys = generateBackupKeyPair();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '3dwd-crypto-test-'));
  });
  after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  // Encrypts `dump` into a file in tempDir and returns its path.
  async function encryptToFile(dump, name = 'dump.enc') {
    const filePath = path.join(tempDir, name);
    const publicKey = backupPublicKey(Buffer.from(keys.publicKey).toString('base64'));
    await pipeline(
      Readable.from([dump]),
      createBackupEncryptor(publicKey),
      fs.createWriteStream(filePath),
    );
    return filePath;
  }

  // Decrypts the file and returns the dump, or rejects.
  async function decryptFile(filePath, privateKey = keys.privateKey) {
    const chunks = [];
    const output = new PassThrough();
    output.on('data', (chunk) => chunks.push(chunk));
    await decryptBackup(filePath, privateKey, output);
    return Buffer.concat(chunks);
  }

  function flipByte(filePath, position) {
    const bytes = fs.readFileSync(filePath);
    bytes[position < 0 ? bytes.length + position : position] ^= 1;
    fs.writeFileSync(filePath, bytes);
  }

  it('round-trips a multi-megabyte dump, which never appears in the file', async () => {
    const dump = crypto.randomBytes(3 * 1024 * 1024);

    const filePath = await encryptToFile(dump);

    assert.ok(!fs.readFileSync(filePath).includes(dump.subarray(0, 64)));
    assert.ok((await decryptFile(filePath)).equals(dump));
  });

  it('throws with a different private key', async () => {
    const filePath = await encryptToFile(Buffer.from('dump'), 'other-key.enc');

    await assert.rejects(decryptFile(filePath, generateBackupKeyPair().privateKey));
  });

  it('throws when a byte of the ciphertext or the tag was changed', async () => {
    const ciphertextChanged = await encryptToFile(Buffer.from('a dump'), 'ciphertext.enc');
    const tagChanged = await encryptToFile(Buffer.from('a dump'), 'tag.enc');
    flipByte(ciphertextChanged, -17);
    flipByte(tagChanged, -1);

    await assert.rejects(decryptFile(ciphertextChanged));
    await assert.rejects(decryptFile(tagChanged));
  });

  it('throws for a file that is not a backup', async () => {
    const filePath = path.join(tempDir, 'not-a-backup.enc');
    fs.writeFileSync(filePath, crypto.randomBytes(1024));

    await assert.rejects(decryptFile(filePath), /Not a 3DWD backup file/);
  });
});

describe('backupPublicKey', () => {
  it('accepts a 4096-bit RSA public key and refuses a short key, a private key or junk', () => {
    const keys = generateBackupKeyPair();
    const short = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const encode = (pem) => Buffer.from(pem).toString('base64');

    assert.equal(backupPublicKey(encode(keys.publicKey)).asymmetricKeyType, 'rsa');
    assert.throws(() => backupPublicKey(encode(short.publicKey)), /at least 4096 bits/);
    assert.throws(() => backupPublicKey(encode(keys.privateKey)), /at least 4096 bits/);
    assert.throws(() => backupPublicKey('not a key'), /at least 4096 bits/);
    assert.throws(() => backupPublicKey(undefined), /at least 4096 bits/);
  });
});
