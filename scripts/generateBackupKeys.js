// Entry point for `npm run backup:keygen -- --out <folder>`: makes the backup key pair
// (docs/deploy.md → Deployment checklist step 10). Writes two files into a folder outside this
// repo, so a private key can never be committed, and prints only their paths: no key reaches
// the terminal, a chat or a log.
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const { generateBackupKeyPair } = require('../lib/crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const PRIVATE_KEY_FILE = 'backup-private-key.pem';
const PUBLIC_KEY_FILE = 'backup-public-key.txt';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) fail('Usage: npm run backup:keygen -- --out <folder outside this repo>');

const outDir = path.resolve(values.out);
if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
  fail(`${outDir} is not a folder.`);
}
const isInsideRepo = !path.relative(REPO_ROOT, outDir).startsWith('..');
if (isInsideRepo) fail('Choose a folder outside this repo, so the private key is never committed.');

const privatePath = path.join(outDir, PRIVATE_KEY_FILE);
const publicPath = path.join(outDir, PUBLIC_KEY_FILE);
if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) {
  fail(`${outDir} already holds a backup key. Move it into 1Password, or choose another folder.`);
}

const { publicKey, privateKey } = generateBackupKeyPair();
// "wx" never overwrites, even if a file appeared since the check above.
fs.writeFileSync(privatePath, privateKey, { flag: 'wx', mode: 0o600 });
fs.writeFileSync(publicPath, `${Buffer.from(publicKey).toString('base64')}\n`, { flag: 'wx' });

console.log(`Private key: ${privatePath}
  Save it in 1Password (3DWD Production) and nowhere else, then delete this file.
  Without it no backup can be read, so keep it until every backup made with it has expired.
Public key: ${publicPath}
  The whole line is the value of BACKUP_PUBLIC_KEY in Render (production). It is not a secret.`);
