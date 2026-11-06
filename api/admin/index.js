// Admin routes, mounted at /api/admin: the site owner accounts, the website picker, Create an
// Account, Link a Website, setting an ability or a gallery live, and the audit events.
const express = require('express');
const prisma = require('../../prisma');
const { ServerError } = require('../../errors');
const requireAuth = require('../../middleware/requireAuth');
const requireRole = require('../../middleware/requireRole');
const { validate } = require('../../validation/validate');
const { createAccountSchema } = require('../../validation/account');
const { websiteChoiceSchema } = require('../../validation/website');
const { listAuditEventsSchema } = require('../../validation/auditEvent');
const { abilityStatusSchema } = require('../../validation/ability');
const { galleryPlacementSchema } = require('../../validation/gallery');
const { normalizeUrl, urlVariants } = require('../../lib/normalizeUrl');
const { findFreeMediaFolder } = require('../../lib/mediaFolder');
const {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  encryptSecret,
} = require('../../lib/crypto');
const { AUDIT_ACTIONS, recordAuditEvent } = require('../../lib/audit');
const { ABILITY_SELECT, toAbility, recordAbilityEvent } = require('../../lib/abilities');
const {
  ABILITY_LIVE_MESSAGES,
  notifyWebsiteOwners,
  galleryLiveMessage,
} = require('../../lib/notifications');
const notifications = require('./notifications');
const threads = require('./threads');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));
router.use('/notifications', notifications);
router.use('/threads', threads);

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
};
const WEBSITE_SUMMARY_SELECT = { id: true, websiteName: true, url: true, active: true };
// A gallery's name, slug (the Gallery Code both dashboards show), status and request note (where
// the site owner wants it), plus one crop column per kind from each of its images (at most 30),
// enough for toAdminGallerySummary's counts and flags. Crops aren't files, so the admin can't see
// them in Cloudinary; this is how the admin knows a site owner cropped a gallery.
const ADMIN_GALLERY_SELECT = {
  id: true,
  galleryName: true,
  slug: true,
  status: true,
  placement: true,
  requestNote: true,
  images: { select: { thumbnailX: true, mobileX: true } },
};
// Every audit_event column but actorId: actorEmail already names the actor.
const AUDIT_EVENT_SELECT = {
  id: true,
  action: true,
  actorEmail: true,
  targetType: true,
  targetId: true,
  metadata: true,
  ip: true,
  createdAt: true,
};

const EMAIL_TAKEN = 'An account with this email already exists.';
const URL_TAKEN = 'A website with this URL already exists. Select it from the dropdown.';

// Existing website path: the chosen website must exist and be active (inactive websites are not
// in the picker). Returns its summary, or throws the 404.
async function assertActiveWebsite(websiteId) {
  const website = await prisma.website.findFirst({
    where: { id: websiteId, active: true },
    select: WEBSITE_SUMMARY_SELECT,
  });
  if (!website) throw new ServerError(404, 'Website not found.');
  return website;
}

// Normalizes a new website's URL and throws the 409 if a website with that URL already exists.
// www.example.com and example.com count as the same website for this check, but the www. is
// kept or left off as entered, because the stored URL is the revalidation target (see
// lib/normalizeUrl.js). Inactive websites are matched too: they are not in the admin's dropdown,
// so their message names the website and says to reactivate it instead.
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
      `A website with this URL already exists but is inactive. It's named ${duplicate.websiteName}. Reactivate and then try again.`,
    );
  }
  if (duplicate) throw new ServerError(409, URL_TAKEN);
  return url;
}

// Generates a new website's API key and webhook secret and inserts the website (hashed key,
// encrypted secret, its media folder) inside the caller's transaction. Returns the website
// summary plus the plaintext credentials, which the caller returns once and never stores or logs.
async function createWebsiteWithCredentials(tx, websiteName, url) {
  const apiKey = generateApiKey();
  const webhookSecret = generateWebhookSecret();

  const website = await tx.website.create({
    data: {
      websiteName,
      url,
      apiKeyHash: hashApiKey(apiKey),
      webhookSecretEncrypted: encryptSecret(webhookSecret),
      mediaFolder: await findFreeMediaFolder(tx, url),
    },
    select: WEBSITE_SUMMARY_SELECT,
  });

  return { website, credentials: { apiKey, webhookSecret } };
}

// Every new website starts with the posts ability, added: its site owner's first post and request
// form move it on (api/siteOwner/abilities.js).
async function addPostsAbility(tx, req, websiteId) {
  const ability = await tx.websiteAbility.create({
    data: { websiteId, kind: 'posts' },
    select: ABILITY_SELECT,
  });
  await recordAbilityEvent(tx, req, AUDIT_ACTIONS.ABILITY_ADDED, ability);
}

// Audit events, written with the transaction client that made the change.
function recordWebsiteCreated(tx, req, websiteId) {
  return recordAuditEvent(tx, req, {
    action: AUDIT_ACTIONS.WEBSITE_CREATED,
    actorId: req.user.id,
    actorEmail: req.user.email,
    targetType: 'website',
    targetId: websiteId,
  });
}

function recordAccountCreated(tx, req, accountId, websiteId) {
  return recordAuditEvent(tx, req, {
    action: AUDIT_ACTIONS.ACCOUNT_CREATED,
    actorId: req.user.id,
    actorEmail: req.user.email,
    targetType: 'account',
    targetId: accountId,
    metadata: { websiteId },
  });
}

function recordWebsiteLinked(tx, req, accountId, websiteId) {
  return recordAuditEvent(tx, req, {
    action: AUDIT_ACTIONS.WEBSITE_LINKED,
    actorId: req.user.id,
    actorEmail: req.user.email,
    targetType: 'account',
    targetId: accountId,
    metadata: { websiteId },
  });
}

// The start (inclusive) and end (exclusive) of a UTC calendar month given as "YYYY-MM", or of the
// current UTC month when none is given.
function toMonthRange(month) {
  const now = new Date();
  const [year, monthNumber] = month
    ? month.split('-').map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 1)),
  };
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

// A gallery row (selected with ADMIN_GALLERY_SELECT) → the contract's AdminGallerySummary. A
// crop's columns are all set or all null, so its x tells whether the image has that crop. A flag
// is true only when every image has the crop: saves already refuse a mix, and this keeps a row
// written any other way from reading as cropped.
function toAdminGallerySummary({ images, ...gallery }) {
  const everyImageHas = (column) =>
    images.length > 0 && images.every((image) => image[column] !== null);
  return {
    ...gallery,
    imageCount: images.length,
    hasThumbnails: everyImageHas('thumbnailX'),
    hasMobileCrops: everyImageHas('mobileX'),
  };
}

// GET /api/admin/accounts — every site owner (active and inactive) with their linked websites, each
// with its abilities (not removed, in the order they were added; the request note is how the site
// owner says where the ability goes), its post summaries (names and statuses only, not deleted,
// drafts included, newest first) and its gallery summaries (not deleted, newest first, each with
// its request note).
router.get('/accounts', async (req, res) => {
  const accounts = await prisma.account.findMany({
    where: { role: 'site_owner' },
    orderBy: { name: 'asc' },
    select: {
      ...ACCOUNT_SELECT,
      accountWebsites: {
        orderBy: { website: { websiteName: 'asc' } },
        select: {
          website: {
            select: {
              ...WEBSITE_SUMMARY_SELECT,
              abilities: {
                where: { removedAt: null },
                orderBy: { createdAt: 'asc' },
                select: ABILITY_SELECT,
              },
              posts: {
                where: { deletedAt: null },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                select: { id: true, postName: true, status: true },
              },
              galleries: {
                where: { deletedAt: null },
                orderBy: { createdAt: 'desc' },
                select: ADMIN_GALLERY_SELECT,
              },
            },
          },
        },
      },
    },
  });

  // Flatten the join rows into the contract's `websites` array.
  const data = accounts.map(({ accountWebsites, ...account }) => ({
    ...account,
    websites: accountWebsites.map(({ website }) => ({
      ...website,
      abilities: website.abilities.map(toAbility),
      galleries: website.galleries.map(toAdminGallerySummary),
    })),
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

// GET /api/admin/auditEvents — one UTC month of audit events, or a from/to range, newest first, a
// page at a time. Query: month (YYYY-MM, default the current month), from and to (instants, sent
// together, replacing month), limit (default 50, max 100) and cursor (the previous page's
// nextCursor). pages is how many pages the whole month or range fills. Read-only: nothing edits or
// deletes audit rows.
router.get('/auditEvents', async (req, res) => {
  const input = validate(listAuditEventsSchema, req.query);
  const { start, end } = input.from
    ? { start: input.from, end: input.to }
    : toMonthRange(input.month);
  const inRange = { createdAt: { gte: start, lt: end } };

  // UUIDv7 ids are time-ordered, so id order is creation order and the cursor is the last id seen.
  // One row more than the page is read to tell whether another page follows. The count ignores
  // the cursor, so pages is the same on every page of one month or range.
  const [events, count] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { ...inRange, ...(input.cursor && { id: { lt: input.cursor } }) },
      orderBy: { id: 'desc' },
      take: input.limit + 1,
      select: AUDIT_EVENT_SELECT,
    }),
    prisma.auditEvent.count({ where: inRange }),
  ]);

  const hasNextPage = events.length > input.limit;
  const data = hasNextPage ? events.slice(0, input.limit) : events;
  res.json({
    data,
    nextCursor: hasNextPage ? data.at(-1).id : null,
    pages: Math.ceil(count / input.limit),
  });
});

// GET /api/admin/auditEvents/months — every UTC month with at least one audit event, as YYYY-MM,
// newest first, so the page's month controls reach only months with events. created_at is a
// timestamp without time zone holding UTC, so to_char gives the UTC month. Prisma can't group by an
// expression, hence the raw query (a tagged template: nothing is interpolated).
router.get('/auditEvents/months', async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT to_char(created_at, 'YYYY-MM') AS month
    FROM audit_event
    ORDER BY month DESC`;
  res.json({ data: rows.map((row) => row.month) });
});

// POST /api/admin/accounts — body { name, email, websiteId } or { name, email, websiteName,
// websiteUrl }. Returns 201 { account, website, credentials? }; credentials only when a new website
// was created.
router.post('/accounts', async (req, res) => {
  const input = validate(createAccountSchema, req.body ?? {});

  const existingAccount = await prisma.account.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existingAccount) throw new ServerError(409, EMAIL_TAKEN);

  const accountData = { name: input.name, email: input.email, role: 'site_owner' };

  try {
    // Existing website path: link only, no key or secret is generated.
    if (input.websiteId) {
      const website = await assertActiveWebsite(input.websiteId);

      const account = await prisma.$transaction(async (tx) => {
        const created = await tx.account.create({ data: accountData, select: ACCOUNT_SELECT });
        await tx.accountWebsite.create({ data: { accountId: created.id, websiteId: website.id } });
        await recordAccountCreated(tx, req, created.id, website.id);
        await recordWebsiteLinked(tx, req, created.id, website.id);
        return created;
      });

      return res.status(201).json({ data: { account, website } });
    }

    // New website path.
    const url = await assertUrlAvailable(input.websiteUrl);

    // Four inserts, plus their audit events: if any one fails, nothing is saved.
    const { account, website, credentials } = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({ data: accountData, select: ACCOUNT_SELECT });
      const { website, credentials } = await createWebsiteWithCredentials(
        tx,
        input.websiteName,
        url,
      );
      await tx.accountWebsite.create({ data: { accountId: account.id, websiteId: website.id } });
      await recordWebsiteCreated(tx, req, website.id);
      await addPostsAbility(tx, req, website.id);
      await recordAccountCreated(tx, req, account.id, website.id);
      await recordWebsiteLinked(tx, req, account.id, website.id);
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

  const input = validate(websiteChoiceSchema, req.body ?? {});

  // Existing website path: link only, no key or secret is generated.
  if (input.websiteId) {
    const website = await assertActiveWebsite(input.websiteId);

    const alreadyLinkedMessage = `This account is already linked to ${website.websiteName}.`;
    const existingLink = await prisma.accountWebsite.findUnique({
      where: { accountId_websiteId: { accountId: account.id, websiteId: website.id } },
      select: { id: true },
    });
    if (existingLink) throw new ServerError(409, alreadyLinkedMessage);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.accountWebsite.create({ data: { accountId: account.id, websiteId: website.id } });
        await recordWebsiteLinked(tx, req, account.id, website.id);
      });
    } catch (err) {
      // Safety net: a concurrent request linked the same pair after the check above.
      if (uniqueConflict(err) === 'link') throw new ServerError(409, alreadyLinkedMessage);
      throw err;
    }

    return res.status(201).json({ data: { website } });
  }

  // New website path.
  const url = await assertUrlAvailable(input.websiteUrl);

  try {
    // Three inserts, plus their audit events: if any one fails, nothing is saved.
    const { website, credentials } = await prisma.$transaction(async (tx) => {
      const created = await createWebsiteWithCredentials(tx, input.websiteName, url);
      await tx.accountWebsite.create({
        data: { accountId: account.id, websiteId: created.website.id },
      });
      await recordWebsiteCreated(tx, req, created.website.id);
      await addPostsAbility(tx, req, created.website.id);
      await recordWebsiteLinked(tx, req, account.id, created.website.id);
      return created;
    });

    // The only time the plaintext key and secret ever leave the server.
    return res.status(201).json({ data: { website, credentials } });
  } catch (err) {
    if (uniqueConflict(err) === 'url') throw new ServerError(409, URL_TAKEN);
    throw err;
  }
});

// PATCH /api/admin/abilities/:id/status — body { status: 'live' }. Sets an ability live once its
// code is wired into the client website. Photo Galleries goes live on its own, with no request;
// each gallery is then set live by the route below. Posts are one switch: their request form must
// be waiting, and setting them live places them too. A removed ability is a 404. The website's
// site owners get an automatic update in the same transaction.
router.patch('/abilities/:id/status', async (req, res) => {
  const { status } = validate(abilityStatusSchema, req.body ?? {});

  const ability = await prisma.websiteAbility.findFirst({
    where: { id: req.params.id, removedAt: null },
    select: ABILITY_SELECT,
  });
  if (!ability) throw new ServerError(404, 'Ability not found.');
  const isPosts = ability.kind === 'posts';
  const isLive = isPosts ? ability.placement === 'live' : ability.status === 'live';
  if (isLive) throw new ServerError(409, 'This ability is already live.');
  if (isPosts && ability.placement === null) {
    throw new ServerError(409, "This ability hasn't been requested yet.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const live = await tx.websiteAbility.update({
      where: { id: ability.id },
      data: isPosts ? { status, placement: 'live' } : { status },
      select: ABILITY_SELECT,
    });
    await recordAbilityEvent(tx, req, AUDIT_ACTIONS.ABILITY_LIVE, live);
    await notifyWebsiteOwners(tx, req, live.websiteId, ABILITY_LIVE_MESSAGES[live.kind]);
    return live;
  });

  res.json({ data: toAbility(updated) });
});

// PATCH /api/admin/galleries/:id/placement — body { placement: 'live' }. Sets a requested gallery
// live once it is placed and styled on the client website and the site owner approved the
// mock-up. Its Photo Galleries ability must be live first: the gallery sits in its component.
// A deleted gallery is a 404. The website's site owners get an automatic update in the same
// transaction. Nothing public changes, so there's no revalidation.
router.patch('/galleries/:id/placement', async (req, res) => {
  const { placement } = validate(galleryPlacementSchema, req.body ?? {});

  const gallery = await prisma.gallery.findFirst({
    where: { id: req.params.id, deletedAt: null },
    select: {
      id: true,
      websiteId: true,
      galleryName: true,
      placement: true,
      website: {
        select: { abilities: { where: { kind: 'galleries' }, select: { status: true } } },
      },
    },
  });
  if (!gallery) throw new ServerError(404, 'Gallery not found.');
  // A gallery that isn't deleted always has its ability (removing it deletes the galleries). If the
  // row were ever missing (SQL by hand, a bug), it reads as not live: a 409 the admin can act on.
  if (gallery.website.abilities[0]?.status !== 'live') {
    throw new ServerError(409, 'Set Photo Galleries live first.');
  }
  if (gallery.placement === 'live') throw new ServerError(409, 'This gallery is already live.');
  if (gallery.placement === null) {
    throw new ServerError(409, "This gallery hasn't been requested yet.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    await recordAuditEvent(tx, req, {
      action: AUDIT_ACTIONS.GALLERY_LIVE,
      actorId: req.user.id,
      actorEmail: req.user.email,
      targetType: 'gallery',
      targetId: gallery.id,
      metadata: { websiteId: gallery.websiteId },
    });
    await notifyWebsiteOwners(tx, req, gallery.websiteId, galleryLiveMessage(gallery.galleryName));
    return tx.gallery.update({
      where: { id: gallery.id },
      data: { placement },
      select: ADMIN_GALLERY_SELECT,
    });
  });

  res.json({ data: toAdminGallerySummary(updated) });
});

module.exports = router;
