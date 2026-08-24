ALTER TABLE "identity_platform_permission_audit"
  DROP CONSTRAINT "identity_platform_permission_audit_action_check";

ALTER TABLE "identity_platform_permission_audit"
  ADD COLUMN "payload_hash" VARCHAR(64) NOT NULL DEFAULT '';

ALTER TABLE "identity_platform_permission_audit"
  ADD CONSTRAINT "identity_platform_permission_audit_action_check"
  CHECK ("action" IN (
    'SYSTEM_BOOTSTRAP_GRANT',
    'SYSTEM_BOOTSTRAP_GRANT_NOOP',
    'SYSTEM_OPERATION_REVOKE',
    'SYSTEM_OPERATION_REVOKE_NOOP'
  ));
