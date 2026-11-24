-- AlterTable
-- The default fills every existing post with a random code (evaluated per row), so the column is
-- NOT NULL at once; it also covers posts the old code creates while this deploy rolls out.
ALTER TABLE "post" ADD COLUMN     "slug" TEXT NOT NULL DEFAULT "left"(replace((gen_random_uuid())::text, '-'::text, ''::text), 8);

-- Backfill: each existing post's slug from its header, by the rule in lib/slug.js → toPostSlug
-- (accents removed, lowercased, other characters one hyphen, at most 60 cut at a word boundary).
-- On one website the earliest post keeps the slug and later ones get -2, -3, deleted posts
-- included. A post with no letter or digit in its header keeps its random code.
-- backfill:start
WITH words AS (
  SELECT id, website_id, created_at,
    trim(both '-' from regexp_replace(
      lower(regexp_replace(normalize(header, NFD), '[̀-ͯ]', '', 'g')),
      '[^a-z0-9]+', '-', 'g')) AS slug
  FROM "post"
), bases AS (
  SELECT id, website_id, created_at,
    NULLIF(CASE WHEN length(slug) <= 60 THEN slug
      ELSE left(regexp_replace(left(slug, 61), '-[^-]*$', ''), 60) END, '') AS base
  FROM words
), numbered AS (
  SELECT id, base,
    row_number() OVER (PARTITION BY website_id, base ORDER BY created_at, id) AS n
  FROM bases
  WHERE base IS NOT NULL
)
UPDATE "post" SET "slug" = CASE WHEN numbered.n = 1 THEN numbered.base
  ELSE numbered.base || '-' || numbered.n END
FROM numbered
WHERE "post"."id" = numbered.id;
-- backfill:end

-- CreateIndex
CREATE UNIQUE INDEX "post_website_id_slug_key" ON "post"("website_id", "slug");
