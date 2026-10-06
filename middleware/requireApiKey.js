// Public endpoint guard: resolves the client website from `Authorization: Bearer <apiKey>`.
// The key is hashed (SHA-256) and looked up by api_key_hash, so the plaintext key is never
// stored or compared directly. Never log the header or the key.
const prisma = require('../prisma');
const { ServerError } = require('../errors');
const { hashApiKey } = require('../lib/crypto');

async function requireApiKey(req, res, next) {
  const match = /^Bearer (\S+)$/.exec(req.get('Authorization') ?? '');

  const website = match
    ? await prisma.website.findUnique({
        where: { apiKeyHash: hashApiKey(match[1]) },
        select: { id: true, active: true },
      })
    : null;

  // Missing header, unknown key or inactive website: one answer for all three.
  if (!website || !website.active) throw new ServerError(401, 'Invalid API key.');

  req.website = { id: website.id };
  next();
}

module.exports = requireApiKey;
