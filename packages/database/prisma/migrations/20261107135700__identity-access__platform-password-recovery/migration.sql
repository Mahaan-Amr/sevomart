CREATE TABLE identity_platform_password_recoveries (
  id uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES identity_identities(id),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity_platform_password_recovery_audit (
  id uuid PRIMARY KEY,
  actor_identity_id uuid REFERENCES identity_identities(id),
  target_identity_id uuid NOT NULL REFERENCES identity_identities(id),
  action varchar(32) NOT NULL,
  reason text NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER identity_platform_password_recovery_audit_immutable
BEFORE UPDATE OR DELETE ON identity_platform_password_recovery_audit
FOR EACH ROW EXECUTE FUNCTION identity_reject_platform_access_audit_change();
