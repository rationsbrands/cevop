-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderItemStatus" ADD VALUE 'PREPARING';
ALTER TYPE "OrderItemStatus" ADD VALUE 'READY';
ALTER TYPE "OrderItemStatus" ADD VALUE 'SERVED';

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "serviceChargeRate" DECIMAL(5,2),
ADD COLUMN     "taxRate" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "serviceChargeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "serviceChargeRate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "serviceChargeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- CreateTable
CREATE TABLE "staff_shifts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "userId" TEXT NOT NULL,
    "clockedInAt" TIMESTAMP(3) NOT NULL,
    "clockedOutAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_shifts_organizationId_idx" ON "staff_shifts"("organizationId");

-- CreateIndex
CREATE INDEX "staff_shifts_branchId_idx" ON "staff_shifts"("branchId");

-- CreateIndex
CREATE INDEX "staff_shifts_userId_idx" ON "staff_shifts"("userId");

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

