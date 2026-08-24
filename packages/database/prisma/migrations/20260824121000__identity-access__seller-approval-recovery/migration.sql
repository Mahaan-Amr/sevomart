CREATE TABLE "identity_seller_approval_recoveries" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "actor_identity_id" UUID NOT NULL,
  "expected_revision" INTEGER NOT NULL,
  "reason_code" VARCHAR(48) NOT NULL,
  "public_reason" VARCHAR(1000) NOT NULL,
  "internal_note" VARCHAR(2000),
  "correlation_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "identity_seller_approval_recoveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_seller_approval_recoveries_application_fkey"
    FOREIGN KEY ("application_id") REFERENCES "identity_seller_applications"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "identity_seller_approval_recoveries_status_check"
    CHECK ("status" IN ('PENDING', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "identity_seller_approval_recoveries_attempt_count_check"
    CHECK ("attempt_count" >= 0)
);

CREATE UNIQUE INDEX "identity_seller_approval_recoveries_actor_key"
  ON "identity_seller_approval_recoveries"("actor_identity_id", "idempotency_key");

CREATE INDEX "identity_seller_approval_recoveries_application_status_idx"
  ON "identity_seller_approval_recoveries"("application_id", "status");
