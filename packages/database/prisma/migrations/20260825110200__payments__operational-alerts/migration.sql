ALTER TABLE "payment_attempts"
  ADD COLUMN "review_started_at" TIMESTAMPTZ(3);

UPDATE "payment_attempts" attempt
SET "review_started_at" = COALESCE(
  (
    SELECT MIN(audit."occurred_at")
    FROM "payment_attempt_audits" audit
    WHERE audit."attempt_id" = attempt."id"
      AND audit."to_status" = 'REVIEW_REQUIRED'
  ),
  attempt."created_at"
)
WHERE attempt."status" = 'REVIEW_REQUIRED';

CREATE TABLE "payment_operational_alerts" (
  "id" UUID NOT NULL,
  "attempt_id" UUID NOT NULL,
  "kind" VARCHAR(48) NOT NULL,
  "severity" VARCHAR(16) NOT NULL DEFAULT 'CRITICAL',
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  "correlation_id" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_operational_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_operational_alerts_kind_check"
    CHECK ("kind" IN ('RECONCILIATION_OVERDUE', 'PAID_STOCK_CONFLICT')),
  CONSTRAINT "payment_operational_alerts_severity_check"
    CHECK ("severity" IN ('CRITICAL')),
  CONSTRAINT "payment_operational_alerts_status_check"
    CHECK ("status" IN ('OPEN', 'RESOLVED')),
  CONSTRAINT "payment_operational_alerts_attempt_kind_key"
    UNIQUE ("attempt_id", "kind")
);

CREATE INDEX "payment_operational_alerts_status_created_idx"
  ON "payment_operational_alerts" ("status", "created_at");
