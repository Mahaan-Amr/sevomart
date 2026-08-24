CREATE TABLE "identity_platform_permission_grants" (
  "id" UUID NOT NULL,
  "identity_id" UUID NOT NULL,
  "permission" VARCHAR(64) NOT NULL,
  "granted_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "identity_platform_permission_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_platform_permission_grants_identity_fkey"
    FOREIGN KEY ("identity_id") REFERENCES "identity_identities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "identity_platform_permission_grants_permission_check"
    CHECK ("permission" IN ('SELLER_APPLICATION_REVIEW'))
);

CREATE UNIQUE INDEX "identity_platform_permission_grants_one_active_idx"
  ON "identity_platform_permission_grants"("identity_id", "permission")
  WHERE "revoked_at" IS NULL;

ALTER TABLE "identity_seller_application_decisions"
  ADD COLUMN "aggregate_version" INTEGER;

UPDATE "identity_seller_application_decisions"
SET "aggregate_version" = "revision";

ALTER TABLE "identity_seller_application_decisions"
  ALTER COLUMN "aggregate_version" SET NOT NULL;

ALTER TABLE "identity_seller_application_decisions"
  ADD CONSTRAINT "identity_seller_application_decisions_aggregate_version_check"
  CHECK ("aggregate_version" > 0);

CREATE OR REPLACE FUNCTION identity_reject_seller_application_audit_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'identity_seller_application_audit is append-only';
END;
$$;

CREATE TRIGGER identity_seller_application_audit_immutable
BEFORE UPDATE OR DELETE ON "identity_seller_application_audit"
FOR EACH ROW EXECUTE FUNCTION identity_reject_seller_application_audit_change();
