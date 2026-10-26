// Uploads to 3DWD's Cloudflare R2 bucket for database backups (docs/deploy.md → Railway services).
// R2 speaks the S3 API, which signs every request with AWS Signature V4; that is built here with
// Node's crypto and fetch, no AWS SDK. The only place R2_SECRET_ACCESS_KEY is read.
// Never log the secret, a signature or the Authorization header.
const crypto = require('crypto');

// R2 takes any region name and uses "auto"; the S3 API is the "s3" service.
const REGION = 'auto';
const SERVICE = 's3';

// Object keys stay within these characters, so the URL path needs no extra encoding to sign.
const SAFE_KEY = /^[\w./-]+$/;

// Read on every call, not at load time, so the values from .env (or testing/setup.js) are used.
function config() {
  return {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
  };
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

// 2026-10-26T08:00:00.123Z → 20261026T080000Z, the form Signature V4 dates take.
function toAmzDate(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

// The Authorization header for one request, by AWS Signature V4: a canonical form of the request,
// a string to sign built from its hash, and an HMAC chain from the secret to the signature.
// `headers` are lowercase names, all of them signed, and must include x-amz-date. No request
// sent from here has a query string, so the canonical query is always empty.
function authorization({ method, path, headers, payloadHash, credentials, region, service }) {
  const amzDate = headers['x-amz-date'];
  const date = amzDate.slice(0, 8);
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(headers[name]).trim()}\n`);
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders.join(''),
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, date);
  const signingKey = hmac(hmac(hmac(dateKey, region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return (
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
}

// Uploads `body` (a Buffer) to the bucket as `key`. Its SHA-256 is signed, so R2 refuses the
// upload if any byte changes on the way. Throws with the HTTP status only, so nothing about the
// request (its Authorization header) can reach a log.
async function putObject(key, body) {
  if (!SAFE_KEY.test(key)) throw new Error(`Unsafe R2 object key: ${key}`);
  const { accountId, accessKeyId, secretAccessKey, bucket } = config();
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const path = `/${bucket}/${key}`;
  const payloadHash = sha256Hex(body);
  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': toAmzDate(new Date()),
  };
  const auth = authorization({
    method: 'PUT',
    path,
    headers,
    payloadHash,
    credentials: { accessKeyId, secretAccessKey },
    region: REGION,
    service: SERVICE,
  });

  // fetch sets Host itself from the URL, so it is signed but not passed.
  const { host: signedHost, ...sentHeaders } = headers;
  const response = await fetch(`https://${signedHost}${path}`, {
    method: 'PUT',
    headers: { ...sentHeaders, Authorization: auth },
    body,
  });
  if (!response.ok) throw new Error(`R2 upload failed: HTTP ${response.status}`);
}

// authorization is exported for its test against AWS's published Signature V4 example.
module.exports = { authorization, putObject };
