-- Ensure every org with operational data has at least one branch
INSERT INTO "branches" ("id", "organizationId", "name", "slug", "isActive", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text) AS "id",
  o."id" AS "organizationId",
  'Main' AS "name",
  'main' AS "slug",
  true AS "isActive",
  NOW() AS "createdAt",
  NOW() AS "updatedAt"
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "branches" b WHERE b."organizationId" = o."id"
)
AND (
  EXISTS (SELECT 1 FROM "tables" t WHERE t."organizationId" = o."id" AND t."branchId" IS NULL)
  OR EXISTS (SELECT 1 FROM "categories" c WHERE c."organizationId" = o."id" AND c."branchId" IS NULL)
  OR EXISTS (SELECT 1 FROM "menu_items" mi WHERE mi."organizationId" = o."id" AND mi."branchId" IS NULL)
  OR EXISTS (SELECT 1 FROM "orders" ord WHERE ord."organizationId" = o."id" AND ord."branchId" IS NULL)
  OR EXISTS (SELECT 1 FROM "waiter_calls" wc WHERE wc."organizationId" = o."id" AND wc."branchId" IS NULL)
  OR EXISTS (SELECT 1 FROM "service_requests" sr WHERE sr."organizationId" = o."id" AND sr."branchId" IS NULL)
  OR EXISTS (SELECT 1 FROM "help_options" ho WHERE ho."organizationId" = o."id" AND ho."branchId" IS NULL)
);

WITH default_branch AS (
  SELECT DISTINCT ON ("organizationId")
    "organizationId",
    "id" AS "branchId"
  FROM "branches"
  ORDER BY "organizationId", "createdAt" ASC
)
UPDATE "tables" t
SET "branchId" = db."branchId"
FROM default_branch db
WHERE t."branchId" IS NULL AND t."organizationId" = db."organizationId";

WITH default_branch AS (
  SELECT DISTINCT ON ("organizationId")
    "organizationId",
    "id" AS "branchId"
  FROM "branches"
  ORDER BY "organizationId", "createdAt" ASC
)
UPDATE "categories" c
SET "branchId" = db."branchId"
FROM default_branch db
WHERE c."branchId" IS NULL AND c."organizationId" = db."organizationId";

-- Keep menu items aligned to their category's branch
UPDATE "menu_items" mi
SET "branchId" = c."branchId"
FROM "categories" c
WHERE mi."categoryId" = c."id" AND (mi."branchId" IS NULL OR mi."branchId" <> c."branchId");

-- Orders/calls/requests must match the table's branch
UPDATE "orders" o
SET "branchId" = t."branchId"
FROM "tables" t
WHERE o."tableId" = t."id" AND (o."branchId" IS NULL OR o."branchId" <> t."branchId");

UPDATE "waiter_calls" wc
SET "branchId" = t."branchId"
FROM "tables" t
WHERE wc."tableId" = t."id" AND (wc."branchId" IS NULL OR wc."branchId" <> t."branchId");

UPDATE "service_requests" sr
SET "branchId" = t."branchId"
FROM "tables" t
WHERE sr."tableId" = t."id" AND (sr."branchId" IS NULL OR sr."branchId" <> t."branchId");

WITH default_branch AS (
  SELECT DISTINCT ON ("organizationId")
    "organizationId",
    "id" AS "branchId"
  FROM "branches"
  ORDER BY "organizationId", "createdAt" ASC
)
UPDATE "help_options" ho
SET "branchId" = db."branchId"
FROM default_branch db
WHERE ho."branchId" IS NULL AND ho."organizationId" = db."organizationId";

-- Enforce NOT NULL at the database layer (industry standard for branch-scoped operations)
ALTER TABLE "tables" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "categories" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "menu_items" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "waiter_calls" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "service_requests" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "help_options" ALTER COLUMN "branchId" SET NOT NULL;

-- Tables are unique per branch (not per org)
DROP INDEX IF EXISTS "tables_organizationId_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "tables_branchId_number_key" ON "tables"("branchId", "number");
