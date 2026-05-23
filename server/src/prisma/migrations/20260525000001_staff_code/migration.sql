-- Add staffCode to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "staffCode" TEXT;

-- Unique per branch (nullable values don't conflict in Postgres unique indexes)
CREATE UNIQUE INDEX IF NOT EXISTS "users_branchId_staffCode_key"
  ON "users"("branchId", "staffCode")
  WHERE "staffCode" IS NOT NULL AND "branchId" IS NOT NULL;
