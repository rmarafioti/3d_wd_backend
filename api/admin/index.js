// Admin routes, mounted at /api/admin: the site owner account list, the active website picker
// Create an Account and Link a Website. Every route requires a signed-in administrator.
// api_key_hash and webhook_secret_encrypted are never selected here; the plaintext key and
// secret exist only in the one response that creates the new website they belong to.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const requireAuth = require('../../middleware/requireAuth');
const requireRole = require('../../middleware/requireRole');
const { validate } = require('../../validation/validate');
const { createAccountSchema } = require('../../validation/account');
const { websiteChoiceSchema } = require('../../validation/website');
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

    // New website path.
    const url = await assertUrlAvailable(body.websiteUrl);

    // Three inserts: if any one fails, nothing is saved.
    const { account, website, credentials } = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({ data: accountData, select: ACCOUNT_SELECT });
      const { website, credentials } = await createWebsiteWithCredentials(
        tx,
        body.websiteName,
        url,
      );
      await tx.accountWebsite.create({ data: { accountId: account.id, websiteId: website.id } });
      return { account, website, credentials };
    });

    // The only time the plaintext key and secret ever leave the server.
    return res.status(201).json({ data: { account, website, credentials } });
  } catch (err) {
    // Safety net: a unique constraint hit after the pre-checks still becomes the 409, not a 500.
    const conflict = uniqueConflict(err);
    if (conflict === 'email') throw new ServerError(409, EMAIL_TAKEN);
    if (conflict === 'url') throw new ServerError(409, URL_TAKEN);
    throw err;
  }
});

// POST /api/admin/accounts/:id/websites — body { websiteId } or { websiteName, websiteUrl }.
// Links another website to an existing site owner. Returns 201 { website, credentials? };
// credentials only when a new website was created.
router.post('/accounts/:id/websites', async (req, res) => {
  const account = await prisma.account.findFirst({
    where: { id: req.params.id, role: 'site_owner' },
    select: { id: true },
  });
  if (!account) throw new ServerError(404, 'Account not found.');

  const body = validate(websiteChoiceSchema, req.body ?? {});

  // Existing website path: link only, no key or secret is generated.
  if (body.websiteId) {
    const website = await prisma.website.findFirst({
      where: { id: body.websiteId, active: true },
      select: WEBSITE_SUMMARY_SELECT,
    });
    if (!website) throw new ServerError(404, 'Website not found.');

    const alreadyLinked = `This account is already linked to ${website.websiteName}.`;
    const existingLink = await prisma.accountWebsite.findUnique({
      where: { accountId_websiteId: { accountId: account.id, websiteId: website.id } },
      select: { id: true },
    });
    if (existingLink) throw new ServerError(409, alreadyLinked);

    try {
      await prisma.accountWebsite.create({
        data: { accountId: account.id, websiteId: website.id },
      });
    } catch (err) {
      // Safety net: a concurrent request linked the same pair after the check above.
      if (uniqueConflict(err) === 'link') throw new ServerError(409, alreadyLinked);
      throw err;
    }

    return res.status(201).json({ data: { website } });
  }

  // New website path.
  const url = await assertUrlAvailable(body.websiteUrl);

  try {
    // Two inserts: if either fails, nothing is saved.
    const { website, credentials } = await prisma.$transaction(async (tx) => {
      const created = await createWebsiteWithCredentials(tx, body.websiteName, url);
      await tx.accountWebsite.create({
        data: { accountId: account.id, websiteId: created.website.id },
      });
      return created;
    });

    // The only time the plaintext key and secret ever leave the server.
    return res.status(201).json({ data: { website, credentials } });
  } catch (err) {
    if (uniqueConflict(err) === 'url') throw new ServerError(409, URL_TAKEN);
    throw err;
  }
});

// Normalizes a new website's URL and throws the 409 if a website with that URL already exists.
// www.example.com and example.com count as the same website for this check, but the URL is
// stored as entered (see lib/normalizeUrl.js). Inactive websites are matched too: they are not
// in the admin's dropdown, so their message names the website and says to reactivate it instead.
// Returns the normalized URL to save.
async function assertUrlAvailable(websiteUrl) {
  const url = normalizeUrl(websiteUrl);
  const duplicate = await prisma.website.findFirst({
    where: { url: { in: urlVariants(url) } },
    select: { websiteName: true, active: true },
  });
  if (duplicate && !duplicate.active) {
    throw new ServerError(
      409,
      `A website with this URL already exists but is inactive — it's named ${duplicate.websiteName}. Reactivate it in Prisma Studio, then try again.`,
    );
  }
  if (duplicate) throw new ServerError(409, URL_TAKEN);
  return url;
}

// Generates a new website's API key and webhook secret and inserts the website (hashed key,
// encrypted secret) inside the caller's transaction. Returns the website summary plus the
// plaintext credentials, which the caller returns once and never stores or logs.
async function createWebsiteWithCredentials(tx, websiteName, url) {
  const apiKey = generateApiKey();
  const webhookSecret = generateWebhookSecret();

  const website = await tx.website.create({
    data: {
      websiteName,
      url,
      apiKeyHash: hashApiKey(apiKey),
      webhookSecretEncrypted: encryptSecret(webhookSecret),
    },
    select: WEBSITE_SUMMARY_SELECT,
  });

  return { website, credentials: { apiKey, webhookSecret } };
}

// Returns 'email', 'url' or 'link' when err is a Prisma unique constraint violation (P2002) on
// that column / pair, otherwise null. With the pg driver adapter the Postgres constraint name
// sits nested in err.meta.driverAdapterError, so the meta object is searched for it as a string.
function uniqueConflict(err) {
  if (err?.code !== 'P2002') return null;
  const meta = JSON.stringify(err.meta ?? {});
  if (meta.includes('account_email_key')) return 'email';
  if (meta.includes('website_url_key')) return 'url';
  if (meta.includes('account_website_account_id_website_id_key')) return 'link';
  return null;
}

module.exports = router;
