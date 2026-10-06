// Mounts every API router under /api, plus the health check Railway uses.
const express = require('express');
const authRouter = require('./auth');
const adminRouter = require('./admin');
const siteOwnerRouter = require('./siteOwner');
const publicRouter = require('./public');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ data: { ok: true } });
});

router.use('/auth', authRouter);
router.use('/admin', adminRouter);
router.use('/siteOwner', siteOwnerRouter);
router.use('/public', publicRouter);

module.exports = router;
