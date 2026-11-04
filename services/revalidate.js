// Tells a client website to regenerate its pages after a post, gallery or ability changed, by
// calling POST {website.url}/api/revalidate. Fire-and-forget: it never rejects.
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
