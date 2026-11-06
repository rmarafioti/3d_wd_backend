// Zod schemas for message threads between a site owner and the admin: start (by either side),
// reply, and the list query.
const { z } = require('zod');
const { blankToUndefined } = require('./validate');
const { requiredText, formattedText, pageShape } = require('./fields');

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

const listThreadsSchema = z.object(pageShape);

module.exports = {
  startThreadSchema,
  startAdminThreadSchema,
  threadMessageSchema,
  listThreadsSchema,
};
