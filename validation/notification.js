// Zod schema for the admin's site-wide updates to site owners: send and edit.
const { z } = require('zod');
const { requiredText, formattedText } = require('./fields');

const notificationSchema = z.object({
  title: requiredText('Title', 120),
  body: formattedText('Body', 10000),
});

module.exports = { notificationSchema };
