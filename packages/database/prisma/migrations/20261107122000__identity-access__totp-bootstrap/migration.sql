CREATE TABLE identity_totp_bootstrap_run (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  first_identity_id UUID NOT NULL,
  second_identity_id UUID NOT NULL,
  reason VARCHAR(500) NOT NULL,
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  CHECK (first_identity_id <> second_identity_id)
);
CREATE TRIGGER identity_totp_bootstrap_immutable BEFORE UPDATE OR DELETE ON identity_totp_bootstrap_run
  FOR EACH ROW EXECUTE FUNCTION identity_reject_totp_audit_change();
