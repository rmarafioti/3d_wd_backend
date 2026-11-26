// Public routes, mounted at /api/public: a client website's published posts, its galleries by slug
// and its contact form, called server-side with its API key.
const express = require('express');
const prisma = require('../../prisma');
const requireApiKey = require('../../middleware/requireApiKey');
const {
  invalidApiKeyRateLimit,
  publicApiRateLimit,
  websiteContactRateLimit,
} = require('../../lib/rateLimit');
const { toDateOnly } = require('../../lib/dates');
const { toBody } = require('../../lib/postBody');
const { ServerError } = require('../../errors');
const { CROP_SELECT, toCroppedImage } = require('../../lib/galleryImages');
const { validate } = require('../../validation/validate');
const { websiteContactSchema } = require('../../validation/contact');
const { AUDIT_ACTIONS, recordAuditEvent } = require('../../lib/audit');
const sendWebsiteInquiryEmail = require('../../services/websiteInquiryEmail');

const router = express.Router();
router.use(invalidApiKeyRateLimit, requireApiKey, publicApiRateLimit);

const GALLERY_NOT_FOUND = 'Gallery not found.';
// Up to 3 photos of at most 1 MB, sent as base64 (a third larger), plus the text fields. app.js
// skips its 256 KB parser for this route, so the key is checked before a large body is read.
const parseContactBody = express.json({ limit: '5mb' });

// GET /api/public/posts — the website's published posts (never a deleted one), newest first, each
// body in reading order; none while posts are turned off. A website finds a post by its slug in
// this list. postName is internal and is never returned here; neither are image ids.
router.get('/posts', async (req, res) => {
  const posts = await prisma.post.findMany({
    where: {
      websiteId: req.website.id,
      status: 'published',
      deletedAt: null,
      website: { abilities: { none: { kind: 'posts', turnedOn: false } } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      slug: true,
      header: true,
      subHeader: true,
      postDate: true,
      createdAt: true,
      updatedAt: true,
      elements: {
        orderBy: { position: 'asc' },
        select: {
          type: true,
          text: true,
          image: { select: { src: true, width: true, height: true, altText: true } },
        },
      },
    },
  });

  const data = posts.map(({ elements, ...post }) => ({
    ...post,
    postDate: toDateOnly(post.postDate),
    body: toBody(elements),
  }));
  res.json({ data });
});

// GET /api/public/galleries/:slug — one of the website's published galleries (never a deleted one,
// nor while galleries are turned off or removed), its images in order, each with its thumbnail and
// mobile versions when the site owner cropped them. galleryName is internal and is never returned
// here; neither are image ids.
router.get('/galleries/:slug', async (req, res) => {
  const gallery = await prisma.gallery.findFirst({
    where: {
      websiteId: req.website.id,
      slug: req.params.slug,
      status: 'published',
      deletedAt: null,
      website: {
        abilities: {
          none: { kind: 'galleries', OR: [{ turnedOn: false }, { removedAt: { not: null } }] },
        },
      },
    },
    select: {
      id: true,
      slug: true,
      title: true,
      copy: true,
      createdAt: true,
      updatedAt: true,
      images: {
        orderBy: { position: 'asc' },
        select: {
          src: true,
          width: true,
          height: true,
          altText: true,
          caption: true,
          ...CROP_SELECT,
        },
      },
    },
  });
  if (!gallery) throw new ServerError(404, GALLERY_NOT_FOUND);

  const data = {
    ...gallery,
    images: gallery.images.map((image) => ({
      src: image.src,
      width: image.width,
      height: image.height,
      altText: image.altText,
      caption: image.caption,
      thumbnail: toCroppedImage(image, 'thumbnail'),
      mobile: toCroppedImage(image, 'mobile'),
    })),
  };
  res.json({ data });
});

// POST /api/public/contact — body { name, email, message?, extras?, images? }. Saves a message
// from the website's contact form with its audit event, then emails it to the website's site
// owners with its photos attached, not awaited. The photos are never stored, only their count.
router.post('/contact', websiteContactRateLimit, parseContactBody, async (req, res) => {
  const { images, ...input } = validate(websiteContactSchema, req.body ?? {});

  const inquiry = await prisma.$transaction(async (tx) => {
    const created = await tx.websiteInquiry.create({
      data: {
        ...input,
        extras: input.extras.length > 0 ? input.extras : undefined,
        imageCount: images.length,
        websiteId: req.website.id,
      },
      select: { id: true },
    });
    // No actor: the visitor isn't an account. The ip is the website's server.
    await recordAuditEvent(tx, req, {
      action: AUDIT_ACTIONS.WEBSITE_INQUIRY_RECEIVED,
      actorId: null,
      actorEmail: null,
      targetType: 'website_inquiry',
      targetId: created.id,
      metadata: { websiteId: req.website.id, imageCount: images.length },
    });
    return created;
  });

  res.status(201).json({ data: { received: true } });
  sendWebsiteInquiryEmail(inquiry.id, images);
});

module.exports = router;
