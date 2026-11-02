-- CreateEnum
CREATE TYPE "ability_kind" AS ENUM ('posts', 'galleries');

-- CreateEnum
CREATE TYPE "ability_status" AS ENUM ('added', 'requested', 'live');

-- CreateTable
CREATE TABLE "website_ability" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "kind" "ability_kind" NOT NULL,
    "status" "ability_status" NOT NULL DEFAULT 'added',
    "turned_on" BOOLEAN NOT NULL DEFAULT true,
    "request_note" TEXT,
    "requested_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_ability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "website_ability_website_id_kind_key" ON "website_ability"("website_id", "kind");

-- AddForeignKey
ALTER TABLE "website_ability" ADD CONSTRAINT "website_ability_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
