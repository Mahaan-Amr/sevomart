ALTER TABLE "identity_platform_permission_grants"
  DROP CONSTRAINT "identity_platform_permission_grants_permission_check";

ALTER TABLE "identity_platform_permission_grants"
  ADD CONSTRAINT "identity_platform_permission_grants_permission_check"
  CHECK ("permission" IN ('SELLER_APPLICATION_REVIEW', 'PAYMENT_REVIEW'));

ALTER TABLE "identity_platform_permission_audit"
  DROP CONSTRAINT "identity_platform_permission_audit_permission_check";

ALTER TABLE "identity_platform_permission_audit"
  ADD CONSTRAINT "identity_platform_permission_audit_permission_check"
  CHECK ("permission" IN ('SELLER_APPLICATION_REVIEW', 'PAYMENT_REVIEW'));
