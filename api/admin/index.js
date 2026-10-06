// Admin routes, mounted at /api/admin: the site owner account list, the active website picker
// and Create an Account. Every route requires a signed-in administrator.
// api_key_hash and webhook_secret_encrypted are never selected here; the plaintext key and
// secret exist only in the one Create an Account response that generates them.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const requireAuth = require('../../middleware/requireAuth');
const requireRole = require('../../middleware/requireRole');
const { validate } = require('../../validation/validate');
const { createAccountSchema } = require('../../validation/account');
const { normalizeUrl, urlVariants } = require('../../lib/normalizeUrl');
const {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  encryptSecret,
} = require('../../lib/crypto');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
};
const WEBSITE_SUMMARY_SELECT = { id: true, websiteName: true, url: true, active: true };

const EMAIL_TAKEN = 'An account with this email already exists.';
const URL_TAKEN = 'A website with this URL already exists — select it from the dropdown.';

// GET /api/admin/accounts — every site owner (active and inactive) with their linked websites.
router.get('/accounts', async (req, res) => {
  const accounts = await prisma.account.findMany({
    where: { role: 'site_owner' },
    orderBy: { name: 'asc' },
    select: {
      ...ACCOUNT_SELECT,
      accountWebsites: {
        orderBy: { website: { websiteName: 'asc' } },
        select: { website: { select: WEBSITE_SUMMARY_SELECT } },
      },
    },
  });

  // Flatten the join rows into the contract's `websites` array.
  const data = accounts.map(({ accountWebsites, ...account }) => ({
    ...account,
    websites: accountWebsites.map((link) => link.website),
  }));
  res.json({ data });
});

// GET /api/admin/websites — active websites only, for the website picker.
router.get('/websites', async (req, res) => {
  const websites = await prisma.website.findMany({
    where: { active: true },
    orderBy: { websiteName: 'asc' },
    select: WEBSITE_SUMMARY_SELECT,
  });
  res.json({ data: websites });
});

// POST /api/admin/accounts — body { name, email, websiteId } or { name, email, websiteName, websiteUrl }.
// Returns 201 { account, website, credentials? }; credentials only when a new website was created.
router.post('/accounts', async (req, res) => {
  const body = validate(createAccountSchema, req.body ?? {});

  const existingAccount = await prisma.account.findUnique({
    where: { email: body.email },
    select: { id: true },
  });
  if (existingAccount) throw new ServerError(409, EMAIL_TAKEN);

  const accountData = { name: body.name, email: body.email, role: 'site_owner' };

  try {
    // Existing website path: link only, no key or secret is generated.
    if (body.websiteId) {
      const website = await prisma.website.findFirst({
        where: { id: body.websiteId, active: true },
        select: WEBSITE_SUMMARY_SELECT,
      });
      if (!website) throw new ServerError(404, 'Website not found.');

      const account = await prisma.$transaction(async (tx) => {
        const created = await tx.account.create({ data: accountData, select: ACCOUNT_SELECT });
        await tx.accountWebsite.create({ data: { accountId: created.id, websiteId: website.id } });
        return created;
      });

      return res.status(201).json({ data: { account, website } });
    }

    // New website path. www.example.com and example.com count as the same website for the
    // duplicate check, but the URL is stored as entered (see lib/normalizeUrl.js).
    const url = normalizeUrl(body.websiteUrl);
    const duplicate = await prisma.website.findFirst({
      where: { url: { in: urlVariants(url) } },
      select: { id: true },
    });
    if (duplicate) throw new ServerError(409, URL_TAKEN);

    const apiKey = generateApiKey();
    const webhookSecret = generateWebhookSecret();

    // Three inserts: if any one fails, nothing is saved.
    const { account, website } = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({ data: accountData, select: ACCOUNT_SELECT });
      const website = await tx.website.create({
        data: {
          websiteName: body.websiteName,
          url,
          apiKeyHash: hashApiKey(apiKey),
          webhookSecretEncrypted: encryptSecret(webhookSecret),
        },
        select: WEBSITE_SUMMARY_SELECT,
      });
      await tx.accountWebsite.create({ data: { accountId: account.id, websiteId: website.id } });
      return { account, website };
    });

    // The only time the plaintext key and secret ever leave the server.
    return res.status(201).json({
      data: { account, website, credentials: { apiKey, webhookSecret } },
    });
  } catch (err) {
    // Safety net: a unique constraint hit after the pre-checks still becomes the 409, not a 500.
    const conflict = uniqueConflict(err);
    if (conflict === 'email') throw new ServerError(409, EMAIL_TAKEN);
    if (conflict === 'url') throw new ServerError(409, URL_TAKEN);
    throw err;
  }
});

// Returns 'email' or 'url' when err is a Prisma unique constraint violation (P2002) on that
// column, otherwise null. With the pg driver adapter the Postgres constraint name sits nested
// in err.meta.driverAdapterError, so the meta object is searched for it as a string.
function uniqueConflict(err) {
  if (err?.code !== 'P2002') return null;
  const meta = JSON.stringify(err.meta ?? {});
  if (meta.includes('account_email_key')) return 'email';
  if (meta.includes('website_url_key')) return 'url';
  return null;
}

module.exports = router;
