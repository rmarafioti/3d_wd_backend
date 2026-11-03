-- Placement (issue #71): where an item sits on the client website, apart from whether its
-- ability's code is wired. Runs before retire_ability_requested, while ability status still says
-- what was requested. "Last live" is the newest ability.live audit event of the website's ability.

-- A gallery with its request message sent is live when its ability is live and it was requested
-- no later than the ability last went live (it was wired in then); otherwise it is still waiting.
UPDATE "gallery" AS g SET "placement" = CASE
  WHEN a."status" = 'live' AND g."requested_at" <= COALESCE(
    (SELECT MAX(e."created_at") FROM "audit_event" AS e
     WHERE e."action" = 'ability.live' AND e."target_type" = 'ability' AND e."target_id" = a."id"),
    a."updated_at"
  ) THEN 'live'::"placement"
  ELSE 'requested'::"placement"
END
FROM "website_ability" AS a
WHERE a."website_id" = g."website_id" AND a."kind" = 'galleries'
  AND g."requested_at" IS NOT NULL AND g."placement" IS NULL;

-- Posts have one placement, on their ability: a live ability's posts are placed, a requested
-- one's are waiting.
UPDATE "website_ability" SET "placement" = "status"::text::"placement"
WHERE "kind" = 'posts' AND "status" IN ('requested', 'live') AND "placement" IS NULL;
