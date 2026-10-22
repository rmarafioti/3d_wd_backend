-- AlterTable
ALTER TABLE "audit_event" ADD COLUMN     "actor_email" TEXT;

-- CreateIndex
CREATE INDEX "audit_event_actor_email_idx" ON "audit_event"("actor_email");
