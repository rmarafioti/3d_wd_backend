// Zod schemas for message threads between a site owner and the admin: start (by either side)
// and reply.
const { z } = require('zod');
const { blankToUndefined } = require('./validate');
const { requiredText, formattedText } = require('./fields');

const subject = requiredText('Subject', 120);
const message = formattedText('Message', 5000);

const startThreadSchema = z.object({ subject, message });

// The admin starts a thread with one site owner, chosen from the Accounts list.
const startAdminThreadSchema = z.object({
  accountId: z.preprocess(blankToUndefined, z.string({ error: 'Choose an account.' })),
  subject,
  message,
});

const threadMessageSchema = z.object({ message });

module.exports = {
  startThreadSchema,
  startAdminThreadSchema,
  threadMessageSchema,
};
