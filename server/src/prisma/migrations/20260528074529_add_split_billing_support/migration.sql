-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_processedBy_fkey";

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "paymentId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "processedBy" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "order_items_paymentId_idx" ON "order_items"("paymentId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_processedBy_fkey" FOREIGN KEY ("processedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
