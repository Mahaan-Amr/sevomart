ALTER TABLE "identity_platform_permission_grants"
  DROP CONSTRAINT "identity_platform_permission_grants_permission_check";

ALTER TABLE "identity_platform_permission_grants"
  ADD CONSTRAINT "identity_platform_permission_grants_permission_check"
  CHECK ("permission" IN (
    'ACCESS_ADMINISTRATION', 'ACCESS_AUDIT_REVIEW',
    'SELLER_APPLICATION_REVIEW', 'PAYMENT_REVIEW', 'PAYMENT_OUTCOME_CHANGE',
    'DISPUTE_REVIEW', 'VIOLATION_REVIEW', 'RELATED_BUYER_CONTEXT_REVEAL',
    'SENSITIVE_IDENTITY_BANKING_BROAD_VIEW', 'HIGH_RISK_BULK_EXPORT'
  ));

ALTER TABLE "identity_platform_permission_audit"
  DROP CONSTRAINT "identity_platform_permission_audit_permission_check";

ALTER TABLE "identity_platform_permission_audit"
  ADD CONSTRAINT "identity_platform_permission_audit_permission_check"
  CHECK ("permission" IN (
    'ACCESS_ADMINISTRATION', 'ACCESS_AUDIT_REVIEW',
    'SELLER_APPLICATION_REVIEW', 'PAYMENT_REVIEW', 'PAYMENT_OUTCOME_CHANGE',
    'DISPUTE_REVIEW', 'VIOLATION_REVIEW', 'RELATED_BUYER_CONTEXT_REVEAL',
    'SENSITIVE_IDENTITY_BANKING_BROAD_VIEW', 'HIGH_RISK_BULK_EXPORT'
  ));

CREATE TABLE "identity_platform_access_grants" (
  "id" UUID NOT NULL,
  "grant_kind" VARCHAR(24) NOT NULL,
  "subject_identity_id" UUID NOT NULL,
  "requested_by_identity_id" UUID NOT NULL,
  "approved_by_identity_id" UUID,
  "responsibility" VARCHAR(64) NOT NULL,
  "purpose_code" VARCHAR(48),
  "scope" JSONB,
  "status" VARCHAR(24) NOT NULL,
  "control_mode" VARCHAR(32) NOT NULL,
  "single_manager_exception" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "activated_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "identity_platform_access_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_platform_access_grants_subject_fkey"
    FOREIGN KEY ("subject_identity_id") REFERENCES "identity_identities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "identity_platform_access_grants_requester_fkey"
    FOREIGN KEY ("requested_by_identity_id") REFERENCES "identity_identities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "identity_platform_access_grants_approver_fkey"
    FOREIGN KEY ("approved_by_identity_id") REFERENCES "identity_identities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "identity_platform_access_grants_kind_check"
    CHECK ("grant_kind" IN ('RESPONSIBILITY', 'SENSITIVE_ACCESS')),
  CONSTRAINT "identity_platform_access_grants_status_check"
    CHECK ("status" IN ('PENDING_APPROVAL', 'ACTIVE', 'EXPIRED', 'REVOKED')),
  CONSTRAINT "identity_platform_access_grants_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "identity_platform_access_grants_shape_check" CHECK (
    ("grant_kind" = 'RESPONSIBILITY' AND "purpose_code" IS NULL
      AND "scope" IS NULL AND "expires_at" IS NULL)
    OR
    ("grant_kind" = 'SENSITIVE_ACCESS' AND "purpose_code" IS NOT NULL
      AND "scope" IS NOT NULL AND "expires_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "identity_platform_access_one_live_responsibility_idx"
  ON "identity_platform_access_grants" ("subject_identity_id", "responsibility")
  WHERE "grant_kind" = 'RESPONSIBILITY'
    AND "status" IN ('PENDING_APPROVAL', 'ACTIVE');

CREATE INDEX "identity_platform_access_subject_status_idx"
  ON "identity_platform_access_grants" ("subject_identity_id", "status", "created_at");

CREATE TABLE "identity_platform_access_idempotency" (
  "operation" VARCHAR(64) NOT NULL,
  "actor_identity_id" UUID NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  "response" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "identity_platform_access_idempotency_pkey"
    PRIMARY KEY ("operation", "actor_identity_id", "key")
);

CREATE TABLE "identity_platform_access_audit" (
  "id" UUID NOT NULL,
  "grant_id" UUID NOT NULL,
  "action" VARCHAR(48) NOT NULL,
  "actor_identity_id" UUID NOT NULL,
  "subject_identity_id" UUID NOT NULL,
  "scope" JSONB,
  "reason_code" VARCHAR(48) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "outcome" VARCHAR(32) NOT NULL,
  "single_manager_exception" BOOLEAN NOT NULL,
  "correlation_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "identity_platform_access_audit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_platform_access_audit_grant_fkey"
    FOREIGN KEY ("grant_id") REFERENCES "identity_platform_access_grants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "identity_platform_access_audit_grant_time_idx"
  ON "identity_platform_access_audit" ("grant_id", "occurred_at", "id");

CREATE OR REPLACE FUNCTION identity_reject_platform_access_audit_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity_platform_access_audit is append-only';
END;
$$;

CREATE TRIGGER identity_platform_access_audit_immutable
BEFORE UPDATE OR DELETE ON "identity_platform_access_audit"
FOR EACH ROW EXECUTE FUNCTION identity_reject_platform_access_audit_change();
