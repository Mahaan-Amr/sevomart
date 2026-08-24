ALTER TABLE "identity_platform_permission_audit"
  DROP CONSTRAINT "identity_platform_permission_audit_key_unique";

ALTER TABLE "identity_platform_permission_audit"
  ADD COLUMN "operation" VARCHAR(16) NOT NULL DEFAULT 'grant',
  ADD COLUMN "actor_scope" VARCHAR(16) NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "actor_kind" VARCHAR(32) NOT NULL DEFAULT 'SYSTEM_BOOTSTRAP';

ALTER TABLE "identity_platform_permission_audit"
  ADD CONSTRAINT "identity_platform_permission_audit_operation_check"
    CHECK ("operation" IN ('grant', 'revoke')),
  ADD CONSTRAINT "identity_platform_permission_audit_actor_scope_check"
    CHECK ("actor_scope" = 'SYSTEM'),
  ADD CONSTRAINT "identity_platform_permission_audit_actor_kind_check"
    CHECK ("actor_kind" IN ('SYSTEM_BOOTSTRAP', 'SYSTEM_OPERATION')),
  ADD CONSTRAINT "identity_platform_permission_audit_operation_key_unique"
    UNIQUE ("operation", "actor_scope", "idempotency_key_hash");
