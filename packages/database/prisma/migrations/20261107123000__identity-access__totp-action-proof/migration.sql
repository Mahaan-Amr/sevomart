CREATE TABLE identity_totp_action_proofs (
  id UUID PRIMARY KEY,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  actor_identity_id UUID NOT NULL REFERENCES identity_identities(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  action VARCHAR(40) NOT NULL,
  target_identity_id UUID NOT NULL REFERENCES identity_identities(id) ON DELETE CASCADE,
  payload_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX identity_totp_action_proofs_expiry_idx ON identity_totp_action_proofs(expires_at);
