// Tells a client website to regenerate its pages after one of its posts changed, by calling
// POST {website.url}/api/revalidate with the website's webhook secret as a Bearer token.
//
// Fire-and-forget: routes call revalidate() after their transaction has committed and after
// responding, without awaiting it. It catches every error itself and never rejects, so a client
// website being down can never affect a site owner's request.
// The webhook secret is selected and decrypted only here. Never log it or the request headers.
const prisma = require('../prisma');
const { decryptSecret } = require('../lib/crypto');

const TIMEOUT_MS = 5000;

async function revalidate(websiteId, postId) {
  try {
    const website = await prisma.website.findUnique({
      where: { id: websiteId },
      select: { id: true, url: true, active: true, webhookSecretEncrypted: true },
    });
    // Inactive websites receive no revalidation calls.
    if (!website || !website.active) return;

    const response = await fetch(`${website.url}/api/revalidate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${decryptSecret(website.webhookSecretEncrypted)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ websiteId: website.id, postId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`Revalidation failed for website ${website.id}: HTTP ${response.status}`);
    }
  } catch (err) {
    // Timeout (TimeoutError), network failure (TypeError: fetch failed) or a database/decrypt
    // error. Only the error's name and message are logged, never the secret or the headers.
    console.error(`Revalidation failed for website ${websiteId}: ${err.name}: ${err.message}`);
  }
}

module.exports = revalidate;
