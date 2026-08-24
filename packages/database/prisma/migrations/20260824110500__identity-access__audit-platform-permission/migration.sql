ALTER TABLE "identity_seller_application_audit"
  ADD COLUMN "permission" VARCHAR(64);

ALTER TABLE "identity_seller_application_audit"
  ADD CONSTRAINT "identity_seller_application_audit_permission_check"
  CHECK ("permission" IS NULL OR "permission" IN ('SELLER_APPLICATION_REVIEW'));
