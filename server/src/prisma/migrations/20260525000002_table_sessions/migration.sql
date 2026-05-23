-- TableStatus enum
CREATE TYPE "TableStatus" AS ENUM ('EMPTY', 'OCCUPIED', 'RESERVED', 'CLEANING');

-- Add status and activeSessionId to tables
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "status" "TableStatus" NOT NULL DEFAULT 'EMPTY';
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "activeSessionId" TEXT;

-- TableSession model
CREATE TABLE IF NOT EXISTS "table_sessions" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId"       TEXT NOT NULL,
  "tableId"        TEXT NOT NULL,
  "openedAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "closedAt"       TIMESTAMPTZ,
  "closedBy"       TEXT,
  "guestCount"     INTEGER,
  "notes"          TEXT,
  CONSTRAINT "table_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "table_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "table_sessions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id"),
  CONSTRAINT "table_sessions_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "table_sessions_tableId_closedAt_idx" ON "table_sessions"("tableId", "closedAt");
CREATE INDEX IF NOT EXISTS "table_sessions_branchId_closedAt_idx" ON "table_sessions"("branchId", "closedAt");
CREATE INDEX IF NOT EXISTS "table_sessions_organizationId_idx" ON "table_sessions"("organizationId");

-- Add sessionId to orders, waiter_calls, service_requests
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "waiter_calls" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

-- Foreign keys (nullable — SetNull on delete)
ALTER TABLE "orders" ADD CONSTRAINT "orders_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "table_sessions"("id") ON DELETE SET NULL;
ALTER TABLE "waiter_calls" ADD CONSTRAINT "waiter_calls_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "table_sessions"("id") ON DELETE SET NULL;
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "table_sessions"("id") ON DELETE SET NULL;

-- RLS for new table (consistent with other tables)
ALTER TABLE "table_sessions" ENABLE ROW LEVEL SECURITY;
