CREATE TABLE identity_session_security_audit (
  id UUID PRIMARY KEY,
  actor_identity_id UUID NOT NULL,
  target_identity_id UUID NOT NULL,
  action VARCHAR(40) NOT NULL,
  incident_id VARCHAR(100) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  revoked_count INTEGER NOT NULL,
  outcome VARCHAR(16) NOT NULL,
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);
CREATE TRIGGER identity_session_security_audit_immutable BEFORE UPDATE OR DELETE ON identity_session_security_audit
  FOR EACH ROW EXECUTE FUNCTION identity_reject_totp_audit_change();
