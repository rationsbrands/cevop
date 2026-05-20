-- Update default plan from 'trial' to 'free' for new organizations
ALTER TABLE "organizations" ALTER COLUMN "plan" SET DEFAULT 'free';
ALTER TABLE "organizations" ALTER COLUMN "planStatus" SET DEFAULT 'active';
