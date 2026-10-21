-- Adds website.media_folder: each website's Cloudinary upload folder (docs/setup.md → Image Hosting).
-- Added nullable, backfilled from each website's URL by the documented rule, then made required
-- and unique, so it applies to a table that already has rows.

-- AlterTable
ALTER TABLE "website" ADD COLUMN "media_folder" TEXT;

-- Backfill: host (no port) → strip a leading "www." → drop the last label → dots to hyphens.
-- Websites that reduce to the same name get -2, -3… in the order they were created.
WITH base AS (
  SELECT
    id,
    created_at,
    replace(
      regexp_replace(
        regexp_replace(split_part(split_part(split_part(url, '://', 2), '/', 1), ':', 1), '^www\.', ''),
        '\.[^.]+$',
        ''
      ),
      '.',
      '-'
    ) AS folder
  FROM "website"
),
numbered AS (
  SELECT id, folder, row_number() OVER (PARTITION BY folder ORDER BY created_at, id) AS n
  FROM base
)
UPDATE "website" w
SET media_folder = CASE WHEN numbered.n = 1 THEN numbered.folder ELSE numbered.folder || '-' || numbered.n END
FROM numbered
WHERE w.id = numbered.id;

ALTER TABLE "website" ALTER COLUMN "media_folder" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "website_media_folder_key" ON "website"("media_folder");
