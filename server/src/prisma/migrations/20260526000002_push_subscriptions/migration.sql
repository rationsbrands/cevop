CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId"       TEXT,
  "app"            TEXT NOT NULL,
  "endpoint"       TEXT NOT NULL,
  "subscription"   JSONB NOT NULL,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "push_subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_organizationId_branchId_idx" ON "push_subscriptions"("organizationId", "branchId");
CREATE INDEX IF NOT EXISTS "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");
