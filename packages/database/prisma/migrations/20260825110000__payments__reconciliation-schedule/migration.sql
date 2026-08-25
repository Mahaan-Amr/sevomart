ALTER TABLE "payment_attempts"
  ADD COLUMN "reconciliation_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_reconciliation_at" TIMESTAMPTZ(3);

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_reconciliation_count_nonnegative"
  CHECK ("reconciliation_count" >= 0);

CREATE INDEX "payment_attempts_reconciliation_due_idx"
  ON "payment_attempts" ("next_reconciliation_at", "id")
  WHERE "status" = 'REVIEW_REQUIRED';
