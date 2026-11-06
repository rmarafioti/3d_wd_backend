-- CreateIndex
CREATE INDEX "post_website_id_deleted_at_idx" ON "post"("website_id", "deleted_at");
