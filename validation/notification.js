// Zod schemas for the admin's site-wide updates to site owners: send, edit, and the list query.
const { z } = require('zod');
const { requiredText, formattedText, pageShape } = require('./fields');

const notificationSchema = z.object({
  title: requiredText('Title', 120),
  body: formattedText('Body', 10000),
});

const listNotificationsSchema = z.object(pageShape);

module.exports = { notificationSchema, listNotificationsSchema };
