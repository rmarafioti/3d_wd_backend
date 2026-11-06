-- CreateTable
CREATE TABLE "thread" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "owner_read_at" TIMESTAMP(3),
    "admin_read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_message" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "thread_account_id_last_message_at_idx" ON "thread"("account_id", "last_message_at");

-- CreateIndex
CREATE INDEX "thread_last_message_at_idx" ON "thread"("last_message_at");

-- CreateIndex
CREATE INDEX "thread_message_thread_id_created_at_idx" ON "thread_message"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "thread_message_author_id_idx" ON "thread_message"("author_id");

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "thread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
