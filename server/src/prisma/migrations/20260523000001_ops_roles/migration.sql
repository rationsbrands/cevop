-- Create OpsRole enum
CREATE TYPE "OpsRole" AS ENUM ('SUPER', 'SUPPORT', 'BILLING', 'READONLY');

-- Add opsRole column to users table (nullable — only set for SUPERADMIN users)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "opsRole" "OpsRole";

-- Set all existing SUPERADMIN users to SUPER (the most permissive role)
-- This ensures no existing ops account loses access
UPDATE "users" SET "opsRole" = 'SUPER' WHERE role = 'SUPERADMIN';
