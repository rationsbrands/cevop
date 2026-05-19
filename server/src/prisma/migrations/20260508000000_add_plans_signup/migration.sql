-- Add plan/billing fields to organizations
ALTER TABLE "organizations" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE "organizations" ADD COLUMN "planStatus" TEXT NOT NULL DEFAULT 'trialing';
ALTER TABLE "organizations" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "verifiedBy" TEXT;
ALTER TABLE "organizations" ADD COLUMN "selfSignup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "organizations" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "organizations" ADD COLUMN "notes" TEXT;

UPDATE "organizations" SET "planStatus" = 'active', "plan" = 'starter';

CREATE INDEX "organizations_planStatus_idx" ON "organizations"("planStatus");
CREATE INDEX "organizations_plan_idx" ON "organizations"("plan");
