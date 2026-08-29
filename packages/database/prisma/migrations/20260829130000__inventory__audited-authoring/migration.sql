ALTER TABLE "inventory_adjustments"
  ADD COLUMN "note" VARCHAR(500),
  ADD COLUMN "operation" VARCHAR(32) NOT NULL DEFAULT 'REPLACE_ON_HAND',
  ADD COLUMN "previous_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_revision" INTEGER;

UPDATE "inventory_adjustments"
SET "previous_revision" = "revision" - 1,
    "next_revision" = "revision";

ALTER TABLE "inventory_adjustments"
  ALTER COLUMN "operation" DROP DEFAULT,
  ALTER COLUMN "previous_revision" DROP DEFAULT,
  ALTER COLUMN "next_revision" SET NOT NULL,
  ADD CONSTRAINT "inventory_adjustments_operation_check"
    CHECK ("operation" = 'REPLACE_ON_HAND'),
  ADD CONSTRAINT "inventory_adjustments_revision_transition_check"
    CHECK ("previous_revision" >= 0 AND "next_revision" = "previous_revision" + 1
      AND "revision" = "next_revision");

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
