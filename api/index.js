// Mounts every API router under /api, plus the health check Render deploys wait on.
const express = require('express');
const authRouter = require('./auth');
const adminRouter = require('./admin');
const siteOwnerRouter = require('./siteOwner');
const publicRouter = require('./public');
const contactRouter = require('./contact');

const router = express.Router();

// GET /api/health — the health check Render waits on before a deploy takes traffic.
router.get('/health', (req, res) => {
  res.json({ data: { ok: true } });
});

router.use('/auth', authRouter);
router.use('/admin', adminRouter);
router.use('/siteOwner', siteOwnerRouter);
router.use('/public', publicRouter);
router.use('/contact', contactRouter);

module.exports = router;
