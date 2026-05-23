-- ---------------------------------------------------------------------------
-- Data hardening / normalization (idempotent)
-- Runs after org roles + BRANCH_FINANCE enum values are committed.
-- ---------------------------------------------------------------------------

-- 1) Ensure every org has an ORG_OWNER:
--    If an organisation has no ORG_OWNER yet, promote its earliest org-wide admin account.
WITH orgs_without_owner AS (
  SELECT o.id AS organization_id
  FROM "organizations" o
  WHERE o.slug <> 'cevop-internal'
    AND NOT EXISTS (
      SELECT 1
      FROM "users" u
      WHERE u."organizationId" = o.id
        AND u."role" = 'ORG_OWNER'
    )
),
candidate_owner AS (
  SELECT DISTINCT ON (u."organizationId") u.id
  FROM "users" u
  JOIN orgs_without_owner owo ON owo.organization_id = u."organizationId"
  WHERE u."role" IN ('ADMIN', 'ORG_MANAGER', 'ORG_FINANCE', 'ORG_AUDITOR')
  ORDER BY
    u."organizationId",
    CASE u."role"
      WHEN 'ADMIN' THEN 1
      WHEN 'ORG_MANAGER' THEN 2
      WHEN 'ORG_FINANCE' THEN 3
      WHEN 'ORG_AUDITOR' THEN 4
      ELSE 9
    END,
    u."createdAt" ASC
)
UPDATE "users"
SET "role" = 'ORG_OWNER'
WHERE id IN (SELECT id FROM candidate_owner);

-- 2) Ensure org-wide roles are never branch-scoped
UPDATE "users"
SET "branchId" = NULL
WHERE "role" IN ('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'ORG_FINANCE', 'ORG_AUDITOR', 'SUPERADMIN')
  AND "branchId" IS NOT NULL;

UPDATE "invite_tokens"
SET "branchId" = NULL
WHERE "role" IN ('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'ORG_FINANCE', 'ORG_AUDITOR', 'SUPERADMIN')
  AND "branchId" IS NOT NULL;

-- 3) Auto-assign branch-scoped roles to the only active branch when the org has exactly 1 active branch
WITH single_branch AS (
  SELECT b."organizationId" AS org_id, MIN(b.id) AS branch_id
  FROM "branches" b
  WHERE b."isActive" = true
  GROUP BY b."organizationId"
  HAVING COUNT(*) = 1
)
UPDATE "users" u
SET "branchId" = sb.branch_id
FROM single_branch sb
WHERE u."organizationId" = sb.org_id
  AND u."role" IN ('BRANCH_ADMIN', 'BRANCH_FINANCE', 'SERVICE', 'WAITER')
  AND u."branchId" IS NULL;

WITH single_branch AS (
  SELECT b."organizationId" AS org_id, MIN(b.id) AS branch_id
  FROM "branches" b
  WHERE b."isActive" = true
  GROUP BY b."organizationId"
  HAVING COUNT(*) = 1
)
UPDATE "invite_tokens" it
SET "branchId" = sb.branch_id
FROM single_branch sb
WHERE it."organizationId" = sb.org_id
  AND it."role" IN ('BRANCH_ADMIN', 'BRANCH_FINANCE', 'SERVICE', 'WAITER')
  AND it."branchId" IS NULL;
