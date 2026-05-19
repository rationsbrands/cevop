-- CreateEnum
CREATE TYPE "HelpOptionType" AS ENUM ('WAITER', 'SERVICE');

-- CreateTable
CREATE TABLE "help_options" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "type" "HelpOptionType" NOT NULL DEFAULT 'SERVICE',
    "label" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "help_options_organizationId_idx" ON "help_options"("organizationId");

-- CreateIndex
CREATE INDEX "help_options_branchId_idx" ON "help_options"("branchId");

-- AddForeignKey
ALTER TABLE "help_options" ADD CONSTRAINT "help_options_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_options" ADD CONSTRAINT "help_options_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
