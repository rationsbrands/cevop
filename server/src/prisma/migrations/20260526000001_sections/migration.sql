-- Section model
CREATE TABLE IF NOT EXISTS "sections" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId"       TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "colour"         TEXT,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "sections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "sections_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sections_branchId_name_key" ON "sections"("branchId", "name");
CREATE INDEX IF NOT EXISTS "sections_organizationId_idx" ON "sections"("organizationId");
CREATE INDEX IF NOT EXISTS "sections_branchId_idx" ON "sections"("branchId");

-- SectionStaff model
CREATE TABLE IF NOT EXISTS "section_staff" (
  "id"         TEXT NOT NULL,
  "sectionId"  TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "assignedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "section_staff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "section_staff_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE,
  CONSTRAINT "section_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "section_staff_sectionId_userId_key" ON "section_staff"("sectionId", "userId");
CREATE INDEX IF NOT EXISTS "section_staff_sectionId_idx" ON "section_staff"("sectionId");
CREATE INDEX IF NOT EXISTS "section_staff_userId_idx" ON "section_staff"("userId");

-- Add sectionId to tables (nullable — tables without a section are unassigned)
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "sectionId" TEXT;
ALTER TABLE "tables" ADD CONSTRAINT "tables_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE SET NULL;

-- RLS
ALTER TABLE "sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "section_staff" ENABLE ROW LEVEL SECURITY;
