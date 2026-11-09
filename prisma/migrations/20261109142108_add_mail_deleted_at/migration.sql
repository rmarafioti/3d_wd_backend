-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "admin_deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notification_recipient" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "thread" ADD COLUMN     "admin_deleted_at" TIMESTAMP(3),
ADD COLUMN     "owner_deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notification_admin_deleted_at_idx" ON "notification"("admin_deleted_at");

-- CreateIndex
CREATE INDEX "notification_recipient_account_id_deleted_at_idx" ON "notification_recipient"("account_id", "deleted_at");

-- CreateIndex
CREATE INDEX "thread_account_id_owner_deleted_at_idx" ON "thread"("account_id", "owner_deleted_at");

-- CreateIndex
CREATE INDEX "thread_admin_deleted_at_idx" ON "thread"("admin_deleted_at");
