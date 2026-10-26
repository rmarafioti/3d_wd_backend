// Tests for the backup key pair generator (scripts/generateBackupKeys.js), run as the real script:
// it refuses a folder inside the repo, and the pair it writes works as BACKUP_PUBLIC_KEY.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { backupPublicKey } = require('../lib/crypto');

const SCRIPT = path.join(__dirname, 'generateBackupKeys.js');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '3dwd-keygen-test-'));

after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

function runKeygen(outDir) {
  return spawnSync(process.execPath, [SCRIPT, '--out', outDir], { encoding: 'utf8' });
}

describe('generateBackupKeys', () => {
  it('refuses a folder inside the repo and writes nothing there', () => {
    const result = runKeygen(__dirname);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside this repo/);
    assert.ok(!fs.existsSync(path.join(__dirname, 'backup-private-key.pem')));
  });

  it('writes a usable public key and a private key only its owner can read, and prints no key', () => {
    const outDir = fs.mkdtempSync(path.join(tempDir, 'new-'));

    const result = runKeygen(outDir);

    assert.equal(result.status, 0);
    const privatePath = path.join(outDir, 'backup-private-key.pem');
    const publicValue = fs.readFileSync(path.join(outDir, 'backup-public-key.txt'), 'utf8').trim();
    assert.equal(backupPublicKey(publicValue).asymmetricKeyDetails.modulusLength, 4096);
    assert.match(fs.readFileSync(privatePath, 'utf8'), /^-----BEGIN PRIVATE KEY-----/);
    assert.equal(fs.statSync(privatePath).mode & 0o777, 0o600);
    assert.ok(!result.stdout.includes('BEGIN') && !result.stdout.includes(publicValue));
  });

  it('refuses to overwrite an existing key file', () => {
    const outDir = fs.mkdtempSync(path.join(tempDir, 'existing-'));
    const privatePath = path.join(outDir, 'backup-private-key.pem');
    fs.writeFileSync(privatePath, 'the key already in use');

    const result = runKeygen(outDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /already holds a backup key/);
    assert.equal(fs.readFileSync(privatePath, 'utf8'), 'the key already in use');
  });
});
