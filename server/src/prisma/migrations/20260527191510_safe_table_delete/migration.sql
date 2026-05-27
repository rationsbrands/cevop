-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_tableId_fkey";

-- DropForeignKey
ALTER TABLE "service_requests" DROP CONSTRAINT "service_requests_tableId_fkey";

-- DropForeignKey
ALTER TABLE "table_sessions" DROP CONSTRAINT "table_sessions_tableId_fkey";

-- DropForeignKey
ALTER TABLE "waiter_calls" DROP CONSTRAINT "waiter_calls_tableId_fkey";

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "tableId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "service_requests" ALTER COLUMN "tableId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "table_sessions" ALTER COLUMN "tableId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "waiter_calls" ALTER COLUMN "tableId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiter_calls" ADD CONSTRAINT "waiter_calls_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
