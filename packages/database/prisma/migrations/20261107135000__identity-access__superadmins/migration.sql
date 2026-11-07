CREATE TABLE identity_platform_superadmins (
  identity_id uuid PRIMARY KEY REFERENCES identity_identities(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE identity_platform_superadmin_audit (
  id uuid PRIMARY KEY,
  actor_identity_id uuid NOT NULL REFERENCES identity_identities(id),
  subject_identity_id uuid NOT NULL REFERENCES identity_identities(id),
  action text NOT NULL CHECK (action IN ('GRANTED', 'REVOKED')),
  reason text NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER identity_platform_superadmin_audit_immutable
BEFORE UPDATE OR DELETE ON identity_platform_superadmin_audit
FOR EACH ROW EXECUTE FUNCTION identity_reject_platform_access_audit_change();
CREATE TABLE identity_platform_superadmin_idempotency (
  actor_identity_id uuid NOT NULL,
  operation text NOT NULL,
  key text NOT NULL,
  payload_hash text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (actor_identity_id, operation, key)
);
