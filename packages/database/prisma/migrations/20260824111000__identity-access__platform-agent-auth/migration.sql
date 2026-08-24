ALTER TABLE "identity_otp_challenges"
  ADD COLUMN "audience" VARCHAR(24) NOT NULL DEFAULT 'PUBLIC';

ALTER TABLE "identity_otp_challenges"
  ADD CONSTRAINT "identity_otp_challenges_audience_check"
  CHECK ("audience" IN ('PUBLIC', 'PLATFORM_AGENT'));

CREATE TABLE "identity_platform_permission_audit" (
  "id" UUID NOT NULL,
  "identity_id" UUID NOT NULL,
  "permission" VARCHAR(64) NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "idempotency_key_hash" VARCHAR(64) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "identity_platform_permission_audit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_platform_permission_audit_identity_fkey"
    FOREIGN KEY ("identity_id") REFERENCES "identity_identities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "identity_platform_permission_audit_permission_check"
    CHECK ("permission" IN ('SELLER_APPLICATION_REVIEW')),
  CONSTRAINT "identity_platform_permission_audit_action_check"
    CHECK ("action" IN ('SYSTEM_BOOTSTRAP_GRANT')),
  CONSTRAINT "identity_platform_permission_audit_key_unique"
    UNIQUE ("idempotency_key_hash")
);

CREATE OR REPLACE FUNCTION identity_reject_platform_permission_audit_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'identity_platform_permission_audit is append-only';
END;
$$;

CREATE TRIGGER identity_platform_permission_audit_immutable
BEFORE UPDATE OR DELETE ON "identity_platform_permission_audit"
FOR EACH ROW EXECUTE FUNCTION identity_reject_platform_permission_audit_change();
