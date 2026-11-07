ALTER TABLE "identity_platform_permission_grants"
  DROP CONSTRAINT "identity_platform_permission_grants_permission_check";
ALTER TABLE "identity_platform_permission_grants"
  ADD CONSTRAINT "identity_platform_permission_grants_permission_check"
  CHECK ("permission" IN (
    'ACCESS_ADMINISTRATION', 'ACCESS_AUDIT_REVIEW', 'SESSION_SECURITY',
    'SELLER_APPLICATION_REVIEW', 'PAYMENT_REVIEW', 'PAYMENT_OUTCOME_CHANGE',
    'DISPUTE_REVIEW', 'VIOLATION_REVIEW', 'RELATED_BUYER_CONTEXT_REVEAL',
    'SENSITIVE_IDENTITY_BANKING_BROAD_VIEW', 'HIGH_RISK_BULK_EXPORT'
  ));
ALTER TABLE "identity_platform_permission_audit"
  DROP CONSTRAINT "identity_platform_permission_audit_permission_check";
ALTER TABLE "identity_platform_permission_audit"
  ADD CONSTRAINT "identity_platform_permission_audit_permission_check"
  CHECK ("permission" IN (
    'ACCESS_ADMINISTRATION', 'ACCESS_AUDIT_REVIEW', 'SESSION_SECURITY',
    'SELLER_APPLICATION_REVIEW', 'PAYMENT_REVIEW', 'PAYMENT_OUTCOME_CHANGE',
    'DISPUTE_REVIEW', 'VIOLATION_REVIEW', 'RELATED_BUYER_CONTEXT_REVEAL',
    'SENSITIVE_IDENTITY_BANKING_BROAD_VIEW', 'HIGH_RISK_BULK_EXPORT'
  ));
