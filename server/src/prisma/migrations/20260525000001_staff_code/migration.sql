-- Add staffCode to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "staffCode" TEXT;

-- Unique per branch
CREATE UNIQUE INDEX IF NOT EXISTS "users_branchId_staffCode_key"
  ON "users"("branchId", "staffCode");
