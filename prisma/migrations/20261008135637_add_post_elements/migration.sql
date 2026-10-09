-- CreateEnum
CREATE TYPE "element_type" AS ENUM ('paragraph', 'image');

-- CreateTable
CREATE TABLE "element" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "element_type" NOT NULL,
    "text" TEXT,
    "image_id" TEXT,

    CONSTRAINT "element_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "element_image_id_key" ON "element"("image_id");

-- CreateIndex
CREATE INDEX "element_post_id_position_idx" ON "element"("post_id", "position");

-- AddForeignKey
ALTER TABLE "element" ADD CONSTRAINT "element_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element" ADD CONSTRAINT "element_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "image"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: each existing post's body becomes its first element (a paragraph at position 0),
-- followed by its images in the order they were added (UUIDv7 id order) at positions 1…n.
-- Element ids use gen_random_uuid() (Postgres 17 has no uuidv7()); elements are always read by
-- position, never by id, so their id order does not matter.
INSERT INTO "element" ("id", "post_id", "position", "type", "text")
SELECT gen_random_uuid()::text, "id", 0, 'paragraph', "body"
FROM "post";

INSERT INTO "element" ("id", "post_id", "position", "type", "image_id")
SELECT gen_random_uuid()::text, "post_id",
       ROW_NUMBER() OVER (PARTITION BY "post_id" ORDER BY "id"), 'image', "id"
FROM "image";
