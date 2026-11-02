-- A live or requested ability backfilled without a request (backfill_website_ability) counts as
-- requested when it was added, so posts are asked again only after a new first post that follows
-- every post being deleted (its oldest post is then newer than requested_at).
UPDATE "website_ability" SET "requested_at" = "created_at"
WHERE "requested_at" IS NULL AND "status" IN ('requested', 'live');
