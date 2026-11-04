-- Feature 8's contract step (issue #73): status is a post's one field. Recompute it from active
-- once more first, in case old code wrote active alone during a deploy; the code since Feature 8
-- always wrote the two in step, so this normally changes no row.
UPDATE "post" SET "status" = (CASE WHEN "active" THEN 'published' ELSE 'draft' END)::"post_status"
WHERE "status" <> (CASE WHEN "active" THEN 'published' ELSE 'draft' END)::"post_status";

-- AlterTable
ALTER TABLE "post" DROP COLUMN "active";
