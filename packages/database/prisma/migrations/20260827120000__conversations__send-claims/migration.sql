ALTER TABLE conversation_idempotency ALTER COLUMN response DROP NOT NULL;
ALTER TABLE conversation_idempotency ADD COLUMN claim_id uuid;
ALTER TABLE conversation_idempotency ADD COLUMN locked_until timestamptz(3);
ALTER TABLE conversation_idempotency ADD CONSTRAINT conversation_idempotency_state CHECK (
  (response IS NOT NULL AND claim_id IS NULL AND locked_until IS NULL)
  OR (response IS NULL AND claim_id IS NOT NULL AND locked_until IS NOT NULL)
);
