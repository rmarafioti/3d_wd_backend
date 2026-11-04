-- Issue #71 stopped writing requested as an ability status, and retire_ability_requested moved
-- every row off it (issue #73 drops it). Postgres can't remove an enum value, so the type is
-- rebuilt without it; the cast fails, and the deploy with it, if any row is still requested.
-- AlterEnum
BEGIN;
CREATE TYPE "ability_status_new" AS ENUM ('added', 'live');
ALTER TABLE "public"."website_ability" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "website_ability" ALTER COLUMN "status" TYPE "ability_status_new" USING ("status"::text::"ability_status_new");
ALTER TYPE "ability_status" RENAME TO "ability_status_old";
ALTER TYPE "ability_status_new" RENAME TO "ability_status";
DROP TYPE "public"."ability_status_old";
ALTER TABLE "website_ability" ALTER COLUMN "status" SET DEFAULT 'added';
COMMIT;
