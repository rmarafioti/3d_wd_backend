// Mounts every API router under /api, plus the health check Railway uses.
// The admin, siteOwner and public routers are added in the Build Order steps that create them.
const express = require('express');
const authRouter = require('./auth');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ data: { ok: true } });
});

router.use('/auth', authRouter);

module.exports = router;
