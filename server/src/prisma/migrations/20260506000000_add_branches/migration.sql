-- Add BRANCH_ADMIN to UserRole enum
ALTER TYPE "UserRole" ADD VALUE 'BRANCH_ADMIN';

-- Create branches table
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- Unique slug per org
CREATE UNIQUE INDEX "branches_organizationId_slug_key" ON "branches"("organizationId", "slug");
CREATE INDEX "branches_organizationId_idx" ON "branches"("organizationId");

-- Add branchId to users
ALTER TABLE "users" ADD COLUMN "branchId" TEXT;
CREATE INDEX "users_branchId_idx" ON "users"("branchId");

-- Add branchId to tables
ALTER TABLE "tables" ADD COLUMN "branchId" TEXT;
CREATE INDEX "tables_branchId_idx" ON "tables"("branchId");

-- Add branchId to categories
ALTER TABLE "categories" ADD COLUMN "branchId" TEXT;
CREATE INDEX "categories_branchId_idx" ON "categories"("branchId");

-- Add branchId to menu_items
ALTER TABLE "menu_items" ADD COLUMN "branchId" TEXT;
CREATE INDEX "menu_items_branchId_idx" ON "menu_items"("branchId");

-- Add branchId to orders
ALTER TABLE "orders" ADD COLUMN "branchId" TEXT;
CREATE INDEX "orders_branchId_idx" ON "orders"("branchId");

-- Add branchId to waiter_calls
ALTER TABLE "waiter_calls" ADD COLUMN "branchId" TEXT;
CREATE INDEX "waiter_calls_branchId_idx" ON "waiter_calls"("branchId");

-- Add branchId to service_requests
ALTER TABLE "service_requests" ADD COLUMN "branchId" TEXT;
CREATE INDEX "service_requests_branchId_idx" ON "service_requests"("branchId");

-- Foreign key: branches → organizations
ALTER TABLE "branches" ADD CONSTRAINT "branches_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys: branchId columns → branches
ALTER TABLE "users" ADD CONSTRAINT "users_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tables" ADD CONSTRAINT "tables_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "categories" ADD CONSTRAINT "categories_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "waiter_calls" ADD CONSTRAINT "waiter_calls_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
