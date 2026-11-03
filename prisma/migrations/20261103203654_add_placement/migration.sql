-- CreateEnum
CREATE TYPE "placement" AS ENUM ('requested', 'live');

-- AlterTable
ALTER TABLE "gallery" ADD COLUMN     "placement" "placement";

-- AlterTable
ALTER TABLE "website_ability" ADD COLUMN     "placement" "placement";
