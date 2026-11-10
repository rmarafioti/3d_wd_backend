// Cursor paging for the list routes: each reads one row more than the page, so the extra row
// tells whether another page follows.
function toPage(rows, limit, toItem = (row) => row) {
  const hasNextPage = rows.length > limit;
  const data = rows.slice(0, limit).map(toItem);
  return { data, nextCursor: hasNextPage ? data.at(-1).id : null };
}

module.exports = { toPage };
