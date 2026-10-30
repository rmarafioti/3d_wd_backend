-- Adds post.status (draft or published) beside post.active, which it replaces (Feature 8,
-- expand → migrate → contract). Every row starts as published; the next migration backfills drafts.

-- CreateEnum
CREATE TYPE "post_status" AS ENUM ('draft', 'published');

-- AlterTable
ALTER TABLE "post" ADD COLUMN     "status" "post_status" NOT NULL DEFAULT 'published';
