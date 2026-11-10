// Zod schemas for Recently Deleted, either role: the items a bulk delete or restore names. The
// list query is pageSchema (validation/fields.js).
const { z } = require('zod');

const MAX_ITEMS = 100;
const MAIL_TYPES = ['update', 'thread'];
const ALL_TYPES = ['post', 'gallery', 'update', 'thread'];

// { items: [{ type, id }] }: 1 to MAX_ITEMS items, each of one of `types`.
function itemsSchema(types, typeMessage) {
  const items = z
    .array(
      z.object({
        type: z.enum(types, { error: typeMessage }),
        id: z.uuid({ error: 'Invalid id.' }),
      }),
      { error: 'Choose at least one item.' },
    )
    .min(1, { error: 'Choose at least one item.' })
    .max(MAX_ITEMS, { error: `Choose at most ${MAX_ITEMS} items.` });
  return z.object({ items });
}

// Bulk delete takes mail only (posts and galleries have their own delete routes), as does the
// admin's restore; the site owner's restore takes every type in their Recently Deleted.
const mailItemsSchema = itemsSchema(MAIL_TYPES, 'Type must be update or thread.');
const allItemsSchema = itemsSchema(ALL_TYPES, 'Type must be post, gallery, update or thread.');

module.exports = { mailItemsSchema, allItemsSchema };
