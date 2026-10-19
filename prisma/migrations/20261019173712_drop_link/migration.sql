/*
  Warnings:

  - You are about to drop the `link` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "link" DROP CONSTRAINT "link_post_id_fkey";

-- DropTable
DROP TABLE "link";
