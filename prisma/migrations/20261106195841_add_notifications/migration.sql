-- CreateEnum
CREATE TYPE "notification_kind" AS ENUM ('general', 'automatic');

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "kind" "notification_kind" NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_recipient" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notification_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_created_by_idx" ON "notification"("created_by");

-- CreateIndex
CREATE INDEX "notification_recipient_notification_id_idx" ON "notification_recipient"("notification_id");

-- CreateIndex
CREATE INDEX "notification_recipient_account_id_read_at_idx" ON "notification_recipient"("account_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_recipient_account_id_notification_id_key" ON "notification_recipient"("account_id", "notification_id");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipient" ADD CONSTRAINT "notification_recipient_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipient" ADD CONSTRAINT "notification_recipient_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
