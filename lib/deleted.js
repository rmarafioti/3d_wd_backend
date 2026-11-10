// Recently Deleted: one list of a viewer's deleted posts, galleries, updates and threads, newest
// deletion first, a page at a time across every type, and running a bulk delete or restore.
const { ServerError } = require('../errors');
const { toPage } = require('./paging');
const { restorableUntil } = require('./retention');

// The failures a bulk delete or restore reports per item; anything else fails the request.
const ITEM_FAILURE_STATUSES = [404, 409];

// Rows deleted before the cursor item in (deletedAt, id) order, newest first. `before` is null on
// the first page.
function beforeWhere(before, deletedAtField, idField) {
  if (!before) return {};
  return {
    OR: [
      { [deletedAtField]: { lt: before.deletedAt } },
      { [deletedAtField]: before.deletedAt, [idField]: { lt: before.id } },
    ],
  };
}

// One type in the list. `model` is its Prisma delegate and `where` its restorable rows for this
// viewer. `idField` is the id the type's restore route takes (an update's is its notificationId),
// and `toItem` turns a row selected with `select` into { id, name, websiteId, websiteName,
// deletedAt }.
function deletedSource({
  type,
  model,
  where,
  select,
  toItem,
  deletedAtField = 'deletedAt',
  idField = 'id',
}) {
  return {
    async findPage(before, take) {
      const rows = await model.findMany({
        where: { AND: [where, beforeWhere(before, deletedAtField, idField)] },
        orderBy: [{ [deletedAtField]: 'desc' }, { [idField]: 'desc' }],
        take,
        select,
      });
      return rows.map((row) => ({ type, ...toItem(row) }));
    },
    // Where an item sits in the order, or null when it isn't (or is no longer) in this list.
    async findDeletedAt(id) {
      const row = await model.findFirst({
        where: { AND: [where, { [idField]: id }] },
        select: { [deletedAtField]: true },
      });
      return row?.[deletedAtField] ?? null;
    },
  };
}

function newestFirst(a, b) {
  const byTime = b.deletedAt.getTime() - a.deletedAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

// One page of the merged list. Each source reads one row more than the page after the cursor, so
// the merged rows hold the whole page and tell whether another follows; no source needs raw SQL.
// The cursor is the last item's id: an item restored before the next page is asked for leaves
// that page empty with nextCursor null, so the list is fetched again from the start.
async function listDeleted(sources, { limit, cursor }) {
  let before = null;
  if (cursor) {
    const positions = await Promise.all(sources.map((source) => source.findDeletedAt(cursor)));
    const deletedAt = positions.find((position) => position !== null);
    if (!deletedAt) return { data: [], nextCursor: null };
    before = { deletedAt, id: cursor };
  }

  const pages = await Promise.all(sources.map((source) => source.findPage(before, limit + 1)));
  const items = pages.flat().sort(newestFirst);
  return toPage(items, limit, (item) => ({
    ...item,
    restorableUntil: restorableUntil(item.deletedAt),
  }));
}

// The items with each { type, id } once, in the order first sent.
function uniqueItems(items) {
  const seen = new Set();
  return items.filter(({ type, id }) => {
    const key = `${type}:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Runs a bulk delete or restore: `handlers[type](id)` for each distinct item, one after another.
// An item whose handler throws a 404 or 409 goes to `failed` with that message, and the rest still
// run; any other error fails the request. Returns { done, failed }.
async function runPerItem(items, handlers) {
  const done = [];
  const failed = [];
  for (const item of uniqueItems(items)) {
    try {
      await handlers[item.type](item.id);
      done.push(item);
    } catch (err) {
      if (!(err instanceof ServerError) || !ITEM_FAILURE_STATUSES.includes(err.status)) throw err;
      failed.push({ ...item, message: err.message });
    }
  }
  return { done, failed };
}

module.exports = { deletedSource, listDeleted, runPerItem };
