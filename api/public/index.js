// Public routes, mounted at /api/public: called server-side by a client's website with its API
// key (Authorization: Bearer <apiKey>). No cookie, no CSRF header, no CORS needed.
// Rate limited twice (lib/rateLimit.js): refused keys per IP, before the key check, and each
// website's calls per website, after it.
const express = require('express');
const prisma = require('../../prisma');
const requireApiKey = require('../../middleware/requireApiKey');
const { invalidApiKeyRateLimit, publicPostsRateLimit } = require('../../lib/rateLimit');
const { toDateOnly } = require('../../lib/dates');
const { toBody } = require('../../lib/postBody');

const router = express.Router();
router.use(invalidApiKeyRateLimit, requireApiKey, publicPostsRateLimit);

// GET /api/public/posts — the website's active posts, newest first, each body in reading order.
// postName is internal and is never returned here; neither are image ids.
router.get('/posts', async (req, res) => {
  const posts = await prisma.post.findMany({
    where: { websiteId: req.website.id, active: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
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

module.exports = router;
