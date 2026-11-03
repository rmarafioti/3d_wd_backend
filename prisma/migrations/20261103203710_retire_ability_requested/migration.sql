-- An ability's status now says only whether its code is wired (issue #71), so requested is no
-- longer a status: an ability requested again after being live goes back to live, and one never
-- set live to added. The enum value stays, unused, until a later cleanup.
UPDATE "website_ability" AS a SET "status" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "audit_event" AS e
    WHERE e."action" = 'ability.live' AND e."target_type" = 'ability' AND e."target_id" = a."id"
  ) THEN 'live'::"ability_status"
  ELSE 'added'::"ability_status"
END
WHERE a."status" = 'requested';
