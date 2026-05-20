-- Compound indexes for Orders
CREATE INDEX IF NOT EXISTS "orders_organizationId_status_idx" ON "orders"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "orders_organizationId_createdAt_idx" ON "orders"("organizationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "orders_organizationId_branchId_status_idx" ON "orders"("organizationId", "branchId", "status");
CREATE INDEX IF NOT EXISTS "orders_organizationId_branchId_createdAt_idx" ON "orders"("organizationId", "branchId", "createdAt" DESC);

-- Compound indexes for WaiterCalls
CREATE INDEX IF NOT EXISTS "waiter_calls_organizationId_status_idx" ON "waiter_calls"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "waiter_calls_organizationId_branchId_status_idx" ON "waiter_calls"("organizationId", "branchId", "status");

-- Compound indexes for ServiceRequests
CREATE INDEX IF NOT EXISTS "service_requests_organizationId_status_idx" ON "service_requests"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "service_requests_organizationId_branchId_status_idx" ON "service_requests"("organizationId", "branchId", "status");

-- Compound indexes for MenuItems
CREATE INDEX IF NOT EXISTS "menu_items_organizationId_isAvailable_idx" ON "menu_items"("organizationId", "isAvailable");
CREATE INDEX IF NOT EXISTS "menu_items_categoryId_isAvailable_idx" ON "menu_items"("categoryId", "isAvailable");

-- Compound indexes for Categories
CREATE INDEX IF NOT EXISTS "categories_organizationId_isActive_idx" ON "categories"("organizationId", "isActive");
