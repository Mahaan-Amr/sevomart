ALTER TABLE "inventory_adjustments"
  ADD COLUMN "note" VARCHAR(500);

CREATE TABLE "inventory_idempotency_records" (
  "operation" VARCHAR(64) NOT NULL,
  "actor_identity_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "response_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_idempotency_records_pkey"
    PRIMARY KEY ("operation", "actor_identity_id", "idempotency_key"),
  CONSTRAINT "inventory_idempotency_records_request_hash_check"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$')
);
