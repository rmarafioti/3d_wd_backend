-- CreateTable
CREATE TABLE "website_inquiry" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT,
    "extras" JSONB,
    "image_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "website_inquiry_website_id_created_at_idx" ON "website_inquiry"("website_id", "created_at");

-- AddForeignKey
ALTER TABLE "website_inquiry" ADD CONSTRAINT "website_inquiry_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
