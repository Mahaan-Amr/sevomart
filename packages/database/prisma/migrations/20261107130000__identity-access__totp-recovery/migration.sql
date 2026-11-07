CREATE TABLE identity_totp_recoveries (
  id UUID PRIMARY KEY,
  requester_identity_id UUID NOT NULL REFERENCES identity_identities(id) ON DELETE CASCADE,
  incident_id VARCHAR(100) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING','APPROVED','ENROLLING','COMPLETED','EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX identity_totp_one_open_recovery ON identity_totp_recoveries(requester_identity_id) WHERE status IN ('PENDING','APPROVED','ENROLLING');
CREATE TABLE identity_totp_recovery_approvals (
  recovery_id UUID NOT NULL REFERENCES identity_totp_recoveries(id) ON DELETE CASCADE,
  approver_identity_id UUID NOT NULL REFERENCES identity_identities(id) ON DELETE CASCADE,
  permission_grant_id UUID NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (recovery_id, approver_identity_id)
);
CREATE TABLE identity_totp_recovery_enrollment (
  recovery_id UUID PRIMARY KEY REFERENCES identity_totp_recoveries(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  key_id VARCHAR(64) NOT NULL,
  ciphertext BYTEA NOT NULL,
  nonce BYTEA NOT NULL,
  tag BYTEA NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE identity_totp_recovery_audit (
  id UUID PRIMARY KEY, recovery_id UUID NOT NULL, actor_identity_id UUID NOT NULL,
  requester_identity_id UUID NOT NULL, action VARCHAR(32) NOT NULL, outcome VARCHAR(16) NOT NULL,
  correlation_id UUID NOT NULL, occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER identity_totp_recovery_audit_immutable BEFORE UPDATE OR DELETE ON identity_totp_recovery_audit
  FOR EACH ROW EXECUTE FUNCTION identity_reject_totp_audit_change();
