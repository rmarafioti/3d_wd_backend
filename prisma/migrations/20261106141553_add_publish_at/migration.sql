-- AlterTable
ALTER TABLE "gallery" ADD COLUMN     "publish_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "post" ADD COLUMN     "publish_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "gallery_status_publish_at_idx" ON "gallery"("status", "publish_at");

-- CreateIndex
CREATE INDEX "post_status_publish_at_idx" ON "post"("status", "publish_at");
