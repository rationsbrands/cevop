-- Add SalaryType enum
CREATE TYPE "SalaryType" AS ENUM ('HOURLY', 'MONTHLY');

-- Add payroll fields to users
ALTER TABLE "users"
  ADD COLUMN "salaryType"          "SalaryType" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "hourlyRate"          DECIMAL(10,2),
  ADD COLUMN "monthlySalary"       DECIMAL(12,2),
  ADD COLUMN "workingDaysPerMonth" INTEGER NOT NULL DEFAULT 22;

-- Add pay snapshot + attendance fields to staff_shifts
ALTER TABLE "staff_shifts"
  ADD COLUMN "salaryType"      "SalaryType" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "hourlyRate"      DECIMAL(10,2),
  ADD COLUMN "monthlySalary"   DECIMAL(12,2),
  ADD COLUMN "breakMinutes"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lateMinutes"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "payAmount"       DECIMAL(12,2),
  ADD COLUMN "notes"           TEXT,
  ADD COLUMN "approvedBy"      TEXT,
  ADD COLUMN "isApproved"      BOOLEAN NOT NULL DEFAULT false;

-- Index on clockedInAt for date-range payroll queries
CREATE INDEX "staff_shifts_clockedInAt_idx" ON "staff_shifts"("clockedInAt");
