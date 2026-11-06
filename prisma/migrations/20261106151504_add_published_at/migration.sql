-- AlterTable
ALTER TABLE "gallery" ADD COLUMN     "published_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "post" ADD COLUMN     "published_at" TIMESTAMP(3);

-- Backfill: an item already published went live no later than it was created; created_at is the
-- best record there is. Drafts stay null.
UPDATE "post" SET "published_at" = "created_at" WHERE "status" = 'published';
UPDATE "gallery" SET "published_at" = "created_at" WHERE "status" = 'published';
