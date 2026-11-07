CREATE TABLE identity_totp_bootstrap_authorizations (
  identity_id UUID PRIMARY KEY REFERENCES identity_identities(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE TABLE identity_totp_factors (
  identity_id UUID PRIMARY KEY REFERENCES identity_identities(id) ON DELETE CASCADE,
  enrollment_session_id UUID NOT NULL,
  key_id VARCHAR(64) NOT NULL,
  ciphertext BYTEA NOT NULL,
  nonce BYTEA NOT NULL,
  tag BYTEA NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'ACTIVE')),
  expires_at TIMESTAMPTZ NOT NULL,
  last_counter BIGINT NOT NULL DEFAULT -1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ
);
CREATE TABLE identity_totp_audit (
  id UUID PRIMARY KEY,
  identity_id UUID NOT NULL,
  action VARCHAR(32) NOT NULL,
  outcome VARCHAR(16) NOT NULL,
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION identity_reject_totp_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'identity_totp_audit is append-only'; END; $$;
CREATE TRIGGER identity_totp_audit_immutable BEFORE UPDATE OR DELETE ON identity_totp_audit
  FOR EACH ROW EXECUTE FUNCTION identity_reject_totp_audit_change();

