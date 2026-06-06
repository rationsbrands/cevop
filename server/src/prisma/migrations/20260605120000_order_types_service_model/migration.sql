-- Order types (dine-in vs takeaway) and branch service model (table / counter / both)

CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKEAWAY');
CREATE TYPE "ServiceModel" AS ENUM ('TABLE_SERVICE', 'COUNTER_SERVICE', 'BOTH');

-- Orders: type, takeaway ticket number, optional customer name
ALTER TABLE "orders"
  ADD COLUMN "orderType"    "OrderType" NOT NULL DEFAULT 'DINE_IN',
  ADD COLUMN "orderNumber"  INTEGER,
  ADD COLUMN "customerName" TEXT;

-- Branches: how the location operates
ALTER TABLE "branches"
  ADD COLUMN "serviceModel" "ServiceModel" NOT NULL DEFAULT 'TABLE_SERVICE';

-- Index for generating the next takeaway number per branch per day
CREATE INDEX "orders_branchId_orderType_createdAt_idx" ON "orders"("branchId", "orderType", "createdAt");
