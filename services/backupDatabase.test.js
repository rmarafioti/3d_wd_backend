// Tests for the database backup (services/backupDatabase.js). pg_dump is played by a mocked
// child_process.spawn and R2 by a mocked fetch, so neither is needed to run the suite. What is
// uploaded must decrypt back to exactly what pg_dump wrote, and any failure must reject.
require('../testing/setup');
const { describe, it, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, PassThrough } = require('node:stream');
const backupDatabase = require('./backupDatabase');
const { generateBackupKeyPair, decryptBackup } = require('../lib/crypto');
const { mockFetch } = require('../testing/helpers');

let keys;
let tempDir;

before(() => {
  keys = generateBackupKeyPair();
  process.env.BACKUP_PUBLIC_KEY = Buffer.from(keys.publicKey).toString('base64');
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '3dwd-backup-test-'));
});
after(() => {
  delete process.env.BACKUP_PUBLIC_KEY;
  fs.rmSync(tempDir, { recursive: true, force: true });
});
afterEach(() => mock.restoreAll());

// Plays pg_dump: writes `output` to stdout and `stderr`, then exits with `exitCode`.
function mockPgDump({ output = 'PGDMP fake dump', exitCode = 0, stderr = '' } = {}) {
  return mock.method(childProcess, 'spawn', () => {
    const dump = new EventEmitter();
    dump.stdout = Readable.from([Buffer.from(output)]);
    dump.stderr = Readable.from(stderr ? [stderr] : []);
    dump.stdout.on('end', () => setImmediate(() => dump.emit('close', exitCode)));
    return dump;
  });
}

// The body the mocked fetch received, decrypted with the test private key.
async function decryptUploaded(fetchMock) {
  const filePath = path.join(tempDir, 'uploaded.enc');
  fs.writeFileSync(filePath, fetchMock.mock.calls[0].arguments[1].body);
  const chunks = [];
  const output = new PassThrough();
  output.on('data', (chunk) => chunks.push(chunk));
  await decryptBackup(filePath, keys.privateKey, output);
  return Buffer.concat(chunks).toString();
}

describe('backupDatabase', () => {
  it('uploads the pg_dump output, encrypted, under a timestamped backups/ key', async (t) => {
    const spawnMock = mockPgDump({ output: 'PGDMP the whole database' });
    const fetchMock = mockFetch(t.mock);

    const { key, size } = await backupDatabase();

    const [command, args] = spawnMock.mock.calls[0].arguments;
    assert.equal(command, 'pg_dump');
    assert.ok(args.includes('--format=custom'));
    assert.match(key, /^backups\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.dump\.enc$/);
    assert.ok(fetchMock.mock.calls[0].arguments[0].endsWith(`/test-backups/${key}`));
    assert.equal(size, fetchMock.mock.calls[0].arguments[1].body.length);
    assert.equal(await decryptUploaded(fetchMock), 'PGDMP the whole database');
  });

  it('puts a label at the start of the file name', async (t) => {
    mockPgDump();
    mockFetch(t.mock);

    const { key } = await backupDatabase({ label: 'test' });

    assert.match(key, /^backups\/test-\d{4}-/);
  });

  it('refuses a label that would change the key', async (t) => {
    const spawnMock = mockPgDump();
    mockFetch(t.mock);

    await assert.rejects(backupDatabase({ label: '../other' }), /The label may only hold/);
    assert.equal(spawnMock.mock.callCount(), 0);
  });

  it('rejects with the exit code and uploads nothing when pg_dump fails', async (t) => {
    mockPgDump({ output: '', exitCode: 1, stderr: 'pg_dump: error: connection failed' });
    const fetchMock = mockFetch(t.mock);

    await assert.rejects(
      backupDatabase(),
      /pg_dump failed \(exit code 1\): pg_dump: error: connection failed/,
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('rejects without the database URL when pg_dump cannot be started', async (t) => {
    mock.method(childProcess, 'spawn', () => {
      const dump = new EventEmitter();
      dump.stdout = Readable.from([]);
      dump.stderr = Readable.from([]);
      setImmediate(() =>
        dump.emit('error', new Error(`spawn pg_dump ENOENT ${process.env.DATABASE_URL}`)),
      );
      return dump;
    });
    mockFetch(t.mock);

    await assert.rejects(backupDatabase(), (err) => {
      assert.equal(err.message, 'pg_dump could not be started. Is it installed?');
      return true;
    });
  });

  it('rejects when R2 refuses the upload', async (t) => {
    mockPgDump();
    mockFetch(t.mock, 500);

    await assert.rejects(backupDatabase(), /R2 upload failed: HTTP 500/);
  });
});
