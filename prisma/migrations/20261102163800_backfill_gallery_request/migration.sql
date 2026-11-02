-- Galleries made before per-gallery request messages count as requested, so the dashboard asks
-- for no message about them. Deleted ones too, in case a removed ability brings them back. The
-- note stays empty: their place on the site was already settled by hand.
UPDATE "gallery" SET "requested_at" = "created_at" WHERE "requested_at" IS NULL;
