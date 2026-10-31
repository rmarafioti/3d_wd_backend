-- CreateEnum
CREATE TYPE "gallery_status" AS ENUM ('draft', 'published');

-- CreateTable
CREATE TABLE "gallery" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "gallery_name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT,
    "copy" TEXT,
    "status" "gallery_status" NOT NULL DEFAULT 'published',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gallery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_image" (
    "id" TEXT NOT NULL,
    "gallery_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "src" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "alt_text" TEXT NOT NULL,
    "caption" TEXT,
    "thumbnail_x" INTEGER,
    "thumbnail_y" INTEGER,
    "thumbnail_width" INTEGER,
    "thumbnail_height" INTEGER,
    "mobile_x" INTEGER,
    "mobile_y" INTEGER,
    "mobile_width" INTEGER,
    "mobile_height" INTEGER,

    CONSTRAINT "gallery_image_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gallery_website_id_slug_key" ON "gallery"("website_id", "slug");

-- CreateIndex
CREATE INDEX "gallery_image_gallery_id_position_idx" ON "gallery_image"("gallery_id", "position");

-- AddForeignKey
ALTER TABLE "gallery" ADD CONSTRAINT "gallery_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_image" ADD CONSTRAINT "gallery_image_gallery_id_fkey" FOREIGN KEY ("gallery_id") REFERENCES "gallery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
