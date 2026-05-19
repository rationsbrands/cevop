-- Add security fields to users
ALTER TABLE "users" ADD COLUMN "loginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "lastLoginIp" TEXT;
ALTER TABLE "users" ADD COLUMN "passwordResetToken" TEXT;
ALTER TABLE "users" ADD COLUMN "passwordResetExpiry" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_passwordResetToken_key" ON "users"("passwordResetToken");
CREATE INDEX "users_email_idx" ON "users"("email");

-- Add fields to organizations
ALTER TABLE "organizations" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos';
ALTER TABLE "organizations" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'NGN';
ALTER TABLE "organizations" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Add fields to branches
ALTER TABLE "branches" ADD COLUMN "email" TEXT;

-- Add notes/resolution fields to waiter_calls
ALTER TABLE "waiter_calls" ADD COLUMN "notes" TEXT;
ALTER TABLE "waiter_calls" ADD COLUMN "resolvedBy" TEXT;
ALTER TABLE "waiter_calls" ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- Add notes/resolution fields to service_requests
ALTER TABLE "service_requests" ADD COLUMN "adminNotes" TEXT;
ALTER TABLE "service_requests" ADD COLUMN "resolvedBy" TEXT;
ALTER TABLE "service_requests" ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- Add ipAddress to audit_logs
ALTER TABLE "audit_logs" ADD COLUMN "ipAddress" TEXT;
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- Add createdAt index to orders
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- Create refresh_tokens table
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
CREATE INDEX "refresh_tokens_tokenHash_idx" ON "refresh_tokens"("tokenHash");
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create onboarding_tokens table
CREATE TABLE "onboarding_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onboarding_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "onboarding_tokens_token_key" ON "onboarding_tokens"("token");
CREATE INDEX "onboarding_tokens_token_idx" ON "onboarding_tokens"("token");
ALTER TABLE "onboarding_tokens" ADD CONSTRAINT "onboarding_tokens_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create invite_tokens table
CREATE TABLE "invite_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invite_tokens_token_key" ON "invite_tokens"("token");
CREATE INDEX "invite_tokens_token_idx" ON "invite_tokens"("token");
CREATE INDEX "invite_tokens_email_idx" ON "invite_tokens"("email");
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
