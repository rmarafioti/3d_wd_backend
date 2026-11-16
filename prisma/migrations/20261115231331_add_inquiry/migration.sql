-- CreateEnum
CREATE TYPE "inquiry_starting_point" AS ENUM ('has_website', 'unfinished_website', 'no_website');

-- CreateTable
CREATE TABLE "inquiry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "business" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "starting_point" "inquiry_starting_point" NOT NULL,
    "goal" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inquiry_email_created_at_idx" ON "inquiry"("email", "created_at");
