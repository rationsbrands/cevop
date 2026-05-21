ALTER TABLE "waiter_calls" ADD COLUMN IF NOT EXISTS "assignedTo" TEXT;
ALTER TABLE "waiter_calls" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMPTZ;
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "assignedTo" TEXT;
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMPTZ;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "assignedWaiter" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "assignedWaiterAt" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "waiter_calls_assignedTo_idx" ON "waiter_calls"("assignedTo");
CREATE INDEX IF NOT EXISTS "service_requests_assignedTo_idx" ON "service_requests"("assignedTo");
CREATE INDEX IF NOT EXISTS "orders_assignedWaiter_idx" ON "orders"("assignedWaiter");

ALTER TABLE "waiter_calls" ADD CONSTRAINT "waiter_calls_assignedTo_fkey"
  FOREIGN KEY ("assignedTo") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assignedTo_fkey"
  FOREIGN KEY ("assignedTo") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_assignedWaiter_fkey"
  FOREIGN KEY ("assignedWaiter") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
