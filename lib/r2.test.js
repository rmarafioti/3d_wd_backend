// Tests for the R2 upload (lib/r2.js): the Signature V4 signing against AWS's published test
// vector, and the PUT it sends, with R2 played by a mocked fetch.
require('../testing/setup');
const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { authorization, putObject } = require('./r2');
const { mockFetch } = require('../testing/helpers');

afterEach(() => mock.restoreAll());

describe('authorization', () => {
  it("matches AWS's Signature V4 test suite (get-vanilla)", () => {
    const header = authorization({
      method: 'GET',
      path: '/',
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: crypto.createHash('sha256').update('').digest('hex'),
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      },
      region: 'us-east-1',
      service: 'service',
    });

    assert.equal(
      header,
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });
});

describe('putObject', () => {
  it("PUTs the body to the bucket's key with its SHA-256 signed", async (t) => {
    const fetchMock = mockFetch(t.mock);
    const body = Buffer.from('encrypted dump');

    await putObject('backups/2026-10-26.dump.enc', body);

    const [url, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(
      url,
      'https://test-account.r2.cloudflarestorage.com/test-backups/backups/2026-10-26.dump.enc',
    );
    assert.equal(options.method, 'PUT');
    assert.equal(options.body, body);
    assert.equal(
      options.headers['x-amz-content-sha256'],
      crypto.createHash('sha256').update(body).digest('hex'),
    );
    assert.match(options.headers['x-amz-date'], /^\d{8}T\d{6}Z$/);
    assert.match(
      options.headers.Authorization,
      /^AWS4-HMAC-SHA256 Credential=test-r2-key\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('throws with only the HTTP status when R2 refuses the upload', async (t) => {
    mockFetch(t.mock, 403);

    await assert.rejects(putObject('backups/a.dump.enc', Buffer.from('x')), (err) => {
      assert.equal(err.message, 'R2 upload failed: HTTP 403');
      return true;
    });
  });

  it('refuses a key with characters that would need encoding', async (t) => {
    const fetchMock = mockFetch(t.mock);

    await assert.rejects(
      putObject('backups/a b.dump.enc', Buffer.from('x')),
      /Unsafe R2 object key/,
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
