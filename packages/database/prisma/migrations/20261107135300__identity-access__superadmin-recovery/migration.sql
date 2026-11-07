ALTER TABLE identity_platform_superadmin_audit ALTER COLUMN actor_identity_id DROP NOT NULL;
ALTER TABLE identity_platform_superadmin_audit ADD COLUMN actor_kind text NOT NULL DEFAULT 'SUPERADMIN';
ALTER TABLE identity_platform_superadmin_audit DROP CONSTRAINT identity_platform_superadmin_audit_action_check;
ALTER TABLE identity_platform_superadmin_audit ADD CONSTRAINT identity_platform_superadmin_audit_action_check CHECK (action IN ('GRANTED', 'REVOKED', 'RECOVERED'));
ALTER TABLE identity_platform_superadmin_audit ADD CONSTRAINT identity_platform_superadmin_audit_actor_check CHECK ((actor_kind = 'SUPERADMIN' AND actor_identity_id IS NOT NULL AND action IN ('GRANTED', 'REVOKED')) OR (actor_kind = 'OWNER_RECOVERY' AND actor_identity_id IS NULL AND action = 'RECOVERED'));
CREATE TABLE identity_platform_superadmin_recovery_idempotency (
  key text PRIMARY KEY,
  payload_hash text NOT NULL,
  response jsonb NOT NULL
);
