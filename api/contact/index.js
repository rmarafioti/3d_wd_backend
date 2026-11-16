// The landing page's contact form: public, with no session or role, behind its own rate limit.
// Saves the inquiry, then emails it (docs/endpoints.md → Inquiry Emails).
const express = require('express');
const prisma = require('../../prisma');
const { validate } = require('../../validation/validate');
const { contactSchema, hasHoneypot } = require('../../validation/contact');
const { contactRateLimit } = require('../../lib/rateLimit');
const { AUDIT_ACTIONS, recordAuditEvent } = require('../../lib/audit');
const sendInquiryEmails = require('../../services/inquiryEmail');

const router = express.Router();
router.use(contactRateLimit);

// The same answer whether the inquiry was saved or a bot was caught, so a bot can't tell.
const RECEIVED = { data: { received: true } };

// POST /api/contact — body { name, business, email, startingPoint, goal, contactCode? }. Saves
// the inquiry with its audit event, then emails the admin and confirms to the sender, not awaited.
router.post('/', async (req, res) => {
  if (hasHoneypot(req.body)) return res.status(201).json(RECEIVED);
  const input = validate(contactSchema, req.body ?? {});

  const inquiry = await prisma.$transaction(async (tx) => {
    const created = await tx.inquiry.create({ data: input, select: { id: true } });
    // No actor: the sender isn't an account, and the email they typed is unverified.
    await recordAuditEvent(tx, req, {
      action: AUDIT_ACTIONS.INQUIRY_RECEIVED,
      actorId: null,
      actorEmail: null,
      targetType: 'inquiry',
      targetId: created.id,
    });
    return created;
  });

  res.status(201).json(RECEIVED);
  sendInquiryEmails(inquiry.id);
});

module.exports = router;
