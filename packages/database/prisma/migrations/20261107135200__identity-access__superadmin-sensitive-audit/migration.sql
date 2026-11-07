CREATE TABLE identity_platform_superadmin_sensitive_audit (
  id uuid PRIMARY KEY,
  actor_identity_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ALLOWED', 'DENIED')),
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER identity_platform_superadmin_sensitive_audit_immutable
BEFORE UPDATE OR DELETE ON identity_platform_superadmin_sensitive_audit
FOR EACH ROW EXECUTE FUNCTION identity_reject_platform_access_audit_change();
