-- Add CASHIER to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CASHIER';

-- Add PaymentMethod enum
DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Create payments table
CREATE TABLE IF NOT EXISTS "payments" (
  "id"             TEXT NOT NULL,
  "sessionId"      TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId"       TEXT NOT NULL,
  "amount"         DECIMAL(10,2) NOT NULL,
  "currency"       TEXT NOT NULL DEFAULT 'NGN',
  "method"         "PaymentMethod" NOT NULL,
  "reference"      TEXT,
  "note"           TEXT,
  "ordersTotal"    DECIMAL(10,2) NOT NULL,
  "processedBy"    TEXT NOT NULL,
  "processedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "table_sessions"("id") ON DELETE CASCADE,
  CONSTRAINT "payments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "payments_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id"),
  CONSTRAINT "payments_processedBy_fkey"
    FOREIGN KEY ("processedBy") REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "payments_sessionId_idx" ON "payments"("sessionId");
CREATE INDEX IF NOT EXISTS "payments_branchId_processedAt_idx" ON "payments"("branchId", "processedAt");
CREATE INDEX IF NOT EXISTS "payments_organizationId_idx" ON "payments"("organizationId");
