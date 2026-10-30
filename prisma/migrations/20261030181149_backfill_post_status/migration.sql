-- Backfills post.status from post.active (Feature 8): an archived post becomes a draft; every
-- other post keeps the published default. Safe to re-run.
UPDATE "post" SET "status" = 'draft' WHERE "active" = false;
