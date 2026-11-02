-- Backfills website_ability (Feature 12, Abilities). Every website gets its posts ability: live
-- where it has a post (Stevie The Dog's posts are wired into its site), otherwise added. Every
-- website with a gallery that isn't deleted gets its galleries ability, requested: the galleries
-- exist but no client website shows them yet. Safe to re-run: an existing row is left as it is.
--
-- Ids are UUIDv7 like every other row (Postgres 17 has no uuidv7()): the current time in
-- milliseconds over the first 6 bytes of a random UUID, with the version bits set to 7.
INSERT INTO "website_ability" ("id", "website_id", "kind", "status", "updated_at")
SELECT
  encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid::text,
  w."id",
  'posts',
  CASE WHEN EXISTS (SELECT 1 FROM "post" p WHERE p."website_id" = w."id")
    THEN 'live'::"ability_status" ELSE 'added'::"ability_status" END,
  CURRENT_TIMESTAMP
FROM "website" w
ON CONFLICT ("website_id", "kind") DO NOTHING;

INSERT INTO "website_ability" ("id", "website_id", "kind", "status", "updated_at")
SELECT
  encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid::text,
  w."id",
  'galleries',
  'requested',
  CURRENT_TIMESTAMP
FROM "website" w
WHERE EXISTS (SELECT 1 FROM "gallery" g WHERE g."website_id" = w."id" AND g."deleted_at" IS NULL)
ON CONFLICT ("website_id", "kind") DO NOTHING;
