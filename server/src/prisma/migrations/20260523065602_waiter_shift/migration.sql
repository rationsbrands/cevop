-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_branchId_fkey";

-- DropForeignKey
ALTER TABLE "help_options" DROP CONSTRAINT "help_options_branchId_fkey";

-- DropForeignKey
ALTER TABLE "menu_items" DROP CONSTRAINT "menu_items_branchId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_branchId_fkey";

-- DropForeignKey
ALTER TABLE "service_requests" DROP CONSTRAINT "service_requests_branchId_fkey";

-- DropForeignKey
ALTER TABLE "tables" DROP CONSTRAINT "tables_branchId_fkey";

-- DropForeignKey
ALTER TABLE "waiter_calls" DROP CONSTRAINT "waiter_calls_branchId_fkey";

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "assignedWaiterAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "notifyNewOrders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyServiceRequests" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyWaiterCalls" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "service_requests" ALTER COLUMN "assignedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isOnShift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shiftEndedAt" TIMESTAMP(3),
ADD COLUMN     "shiftStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "waiter_calls" ALTER COLUMN "assignedAt" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "help_options" ADD CONSTRAINT "help_options_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiter_calls" ADD CONSTRAINT "waiter_calls_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
