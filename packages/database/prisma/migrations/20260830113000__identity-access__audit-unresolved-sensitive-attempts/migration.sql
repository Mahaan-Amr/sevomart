BEGIN;

LOCK TABLE "identity_platform_access_audit" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "identity_platform_access_audit"
  DROP CONSTRAINT "identity_platform_access_audit_grant_fkey";

ALTER TABLE "identity_platform_access_audit"
  ADD COLUMN "resolved_grant_id" UUID,
  ADD COLUMN "attempted_responsibility" VARCHAR(64),
  ALTER COLUMN "subject_identity_id" DROP NOT NULL,
  ALTER COLUMN "single_manager_exception" DROP NOT NULL;

-- The table is already append-only. Disable its guard only while backfilling
-- additive resolution metadata under this migration's ACCESS EXCLUSIVE lock.
ALTER TABLE "identity_platform_access_audit"
  DISABLE TRIGGER "identity_platform_access_audit_immutable";

UPDATE "identity_platform_access_audit" audit
SET "resolved_grant_id" = audit."grant_id",
    "attempted_responsibility" = source_grant."responsibility"
FROM "identity_platform_access_grants" source_grant
WHERE source_grant."id" = audit."grant_id";

ALTER TABLE "identity_platform_access_audit"
  ENABLE TRIGGER "identity_platform_access_audit_immutable";

ALTER TABLE "identity_platform_access_audit"
  ADD CONSTRAINT "identity_platform_access_audit_resolved_grant_fkey"
    FOREIGN KEY ("resolved_grant_id")
    REFERENCES "identity_platform_access_grants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "identity_platform_access_audit_resolution_check" CHECK (
    (
      "resolved_grant_id" IS NOT NULL
      AND "grant_id" = "resolved_grant_id"
      AND "subject_identity_id" IS NOT NULL
      AND "single_manager_exception" IS NOT NULL
    )
    OR
    (
      "resolved_grant_id" IS NULL
      AND "subject_identity_id" IS NULL
      AND "single_manager_exception" IS NULL
      AND "attempted_responsibility" IS NOT NULL
      AND "scope" IS NOT NULL
      AND "action" IN ('SENSITIVE_FIELD_REVEALED', 'SENSITIVE_CHANGE_ATTEMPTED')
      AND "reason_code" = 'ACCESS_REQUEST_REJECTED'
      AND "outcome" = 'DENIED'
    )
  );

CREATE INDEX "identity_platform_access_audit_resolved_grant_time_idx"
  ON "identity_platform_access_audit" ("resolved_grant_id", "occurred_at", "id")
  WHERE "resolved_grant_id" IS NOT NULL;

COMMIT;
