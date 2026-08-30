ALTER TABLE "identity_platform_access_grants"
  DROP CONSTRAINT "identity_platform_access_grants_kind_check",
  DROP CONSTRAINT "identity_platform_access_grants_status_check",
  DROP CONSTRAINT "identity_platform_access_grants_shape_check",
  ALTER COLUMN "responsibility" DROP NOT NULL,
  ADD COLUMN "incident_id" VARCHAR(120),
  ADD COLUMN "review_due_at" TIMESTAMPTZ(3),
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(3),
  ADD COLUMN "reviewed_by_identity_id" UUID,
  ADD COLUMN "review_mode" VARCHAR(48),
  ADD COLUMN "review_finding_code" VARCHAR(48),
  ADD COLUMN "rejected_at" TIMESTAMPTZ(3);

ALTER TABLE "identity_platform_access_grants"
  ADD CONSTRAINT "identity_platform_access_grants_kind_check"
    CHECK ("grant_kind" IN ('RESPONSIBILITY', 'SENSITIVE_ACCESS', 'EMERGENCY_ACCESS')),
  ADD CONSTRAINT "identity_platform_access_grants_status_check"
    CHECK ("status" IN ('PENDING_APPROVAL', 'ACTIVE', 'EXPIRED', 'REVOKED', 'CLOSED')),
  ADD CONSTRAINT "identity_platform_access_grants_review_fkey"
    FOREIGN KEY ("reviewed_by_identity_id") REFERENCES "identity_identities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "identity_platform_access_grants_shape_check" CHECK (
    ("grant_kind" = 'RESPONSIBILITY' AND "responsibility" IS NOT NULL
      AND "purpose_code" IS NULL AND "incident_id" IS NULL
      AND "scope" IS NULL AND "expires_at" IS NULL AND "review_due_at" IS NULL)
    OR
    ("grant_kind" = 'SENSITIVE_ACCESS' AND "responsibility" IS NOT NULL
      AND "purpose_code" IS NOT NULL AND "incident_id" IS NULL
      AND "scope" IS NOT NULL AND "expires_at" IS NOT NULL
      AND "review_due_at" IS NULL)
    OR
    ("grant_kind" = 'EMERGENCY_ACCESS' AND "responsibility" IS NULL
      AND "purpose_code" IS NULL AND "incident_id" IS NOT NULL
      AND "scope" IS NOT NULL AND "expires_at" IS NOT NULL
      AND "review_due_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "identity_platform_access_grants_review_shape_check" CHECK (
    ("reviewed_at" IS NULL AND "reviewed_by_identity_id" IS NULL
      AND "review_mode" IS NULL AND "review_finding_code" IS NULL)
    OR
    ("grant_kind" = 'EMERGENCY_ACCESS' AND "reviewed_at" IS NOT NULL
      AND "reviewed_by_identity_id" IS NOT NULL
      AND "review_mode" IN ('INDEPENDENT', 'WITHOUT_INDEPENDENT_REVIEW')
      AND "review_finding_code" IN (
        'CONTROLS_FOLLOWED', 'SCOPE_EXCEEDED', 'AUDIT_INCOMPLETE', 'FOLLOW_UP_REQUIRED'
      ))
  );

CREATE INDEX "identity_platform_access_overdue_review_idx"
  ON "identity_platform_access_grants" ("requested_by_identity_id", "review_due_at")
  WHERE "grant_kind" = 'EMERGENCY_ACCESS'
    AND "activated_at" IS NOT NULL AND "reviewed_at" IS NULL;

CREATE TABLE "identity_platform_emergency_access_reviews" (
  "id" UUID NOT NULL,
  "grant_id" UUID NOT NULL,
  "reviewer_identity_id" UUID NOT NULL,
  "review_mode" VARCHAR(48) NOT NULL,
  "finding_code" VARCHAR(48) NOT NULL,
  "review_due_at" TIMESTAMPTZ(3) NOT NULL,
  "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
  "supersedes_review_id" UUID,
  "correlation_id" UUID NOT NULL,
  CONSTRAINT "identity_platform_emergency_access_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_platform_emergency_access_reviews_grant_fkey"
    FOREIGN KEY ("grant_id") REFERENCES "identity_platform_access_grants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "identity_platform_emergency_access_reviews_reviewer_fkey"
    FOREIGN KEY ("reviewer_identity_id") REFERENCES "identity_identities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "identity_platform_emergency_access_reviews_supersedes_fkey"
    FOREIGN KEY ("supersedes_review_id")
    REFERENCES "identity_platform_emergency_access_reviews"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "identity_platform_emergency_access_reviews_mode_check"
    CHECK ("review_mode" IN ('INDEPENDENT', 'WITHOUT_INDEPENDENT_REVIEW')),
  CONSTRAINT "identity_platform_emergency_access_reviews_finding_check"
    CHECK ("finding_code" IN (
      'CONTROLS_FOLLOWED', 'SCOPE_EXCEEDED', 'AUDIT_INCOMPLETE', 'FOLLOW_UP_REQUIRED'
    ))
);

CREATE INDEX "identity_platform_emergency_access_reviews_grant_time_idx"
  ON "identity_platform_emergency_access_reviews" ("grant_id", "reviewed_at", "id");

CREATE OR REPLACE FUNCTION identity_reject_emergency_access_review_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity_platform_emergency_access_reviews is append-only';
END;
$$;

CREATE TRIGGER identity_platform_emergency_access_reviews_immutable
BEFORE UPDATE OR DELETE ON "identity_platform_emergency_access_reviews"
FOR EACH ROW EXECUTE FUNCTION identity_reject_emergency_access_review_change();

ALTER TABLE "identity_platform_access_audit"
  DROP CONSTRAINT "identity_platform_access_audit_resolution_check",
  ADD COLUMN "attempted_grant_kind" VARCHAR(24),
  ADD COLUMN "attempted_incident_id" VARCHAR(120),
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
      AND "scope" IS NOT NULL
      AND "action" IN ('SENSITIVE_FIELD_REVEALED', 'SENSITIVE_CHANGE_ATTEMPTED')
      AND "reason_code" = 'ACCESS_REQUEST_REJECTED'
      AND "outcome" = 'DENIED'
      AND (
        (
          "attempted_responsibility" IS NOT NULL
          AND "attempted_incident_id" IS NULL
          AND ("attempted_grant_kind" IS NULL OR "attempted_grant_kind" = 'SENSITIVE_ACCESS')
        )
        OR
        (
          "attempted_responsibility" IS NULL
          AND "attempted_grant_kind" = 'EMERGENCY_ACCESS'
          AND "attempted_incident_id" IS NOT NULL
        )
      )
    )
  );
