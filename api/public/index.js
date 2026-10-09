// Public routes, mounted at /api/public: called server-side by a client's website with its API
// key (Authorization: Bearer <apiKey>). No cookie, no CSRF header, no CORS needed.
const express = require('express');
const prisma = require('../../prisma');
const requireApiKey = require('../../middleware/requireApiKey');
const { toDateOnly } = require('../../lib/dates');
const { toBody } = require('../../lib/postBody');

const router = express.Router();
router.use(requireApiKey);

// GET /api/public/posts — the website's active posts, newest first, each body in reading order.
// postName is internal and is never returned here; neither are image/link ids.
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
      links: { orderBy: { id: 'asc' }, select: { name: true, url: true } },
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
