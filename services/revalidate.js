// Tells a client website to regenerate its pages after one of its posts or galleries changed, by
// calling POST {website.url}/api/revalidate with the website's webhook secret as a Bearer token.
// The body names what changed: { websiteId, postId }, { websiteId, galleryId }, or { websiteId,
// ability } when an ability was turned on or off, removed or restored.
//
// Fire-and-forget: routes call revalidate() after their transaction has committed and after
// responding, without awaiting it. It catches every error itself and never rejects, so a client
// website being down can never affect a site owner's request.
// The webhook secret is selected and decrypted only here. Never log it or the request headers.
//
// A failure is also reported to Sentry as a warning (production only, lib/sentry.js), grouped per
// website: the client website is usually up but set up wrong (a webhook secret that doesn't match,
// a missing route, a redirect), so its new content silently never appears. Only the website id and
// the status or error name are sent, never the URL, the secret or the headers.
const prisma = require('../prisma');
const { decryptSecret } = require('../lib/crypto');
const { reportWarning } = require('../lib/sentry');

const TIMEOUT_MS = 5000;

function revalidationFailed(websiteId, reason) {
  const message = `Revalidation failed for website ${websiteId}: ${reason}`;
  console.error(message);
  reportWarning(message, ['revalidation', websiteId]);
}

// `changed` is { postId }, { galleryId } or { ability }.
async function revalidate(websiteId, changed) {
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
      body: JSON.stringify({ websiteId: website.id, ...changed }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) revalidationFailed(website.id, `HTTP ${response.status}`);
  } catch (err) {
    // Timeout (TimeoutError), network failure (TypeError: fetch failed) or a database/decrypt
    // error. Only the error's name and message are logged, never the secret or the headers.
    revalidationFailed(websiteId, `${err.name}: ${err.message}`);
  }
}

module.exports = revalidate;
