ALTER TABLE "platform_outbox_consumptions"
  ALTER COLUMN "consumed_at" DROP NOT NULL,
  ADD COLUMN "status" VARCHAR(24) NOT NULL DEFAULT 'PROCESSED',
  ADD COLUMN "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lease_owner" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error" VARCHAR(500),
  ADD COLUMN "failed_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "platform_outbox_consumptions_status_check"
    CHECK ("status" IN ('READY', 'LEASED', 'PROCESSED', 'FAILED')),
  ADD CONSTRAINT "platform_outbox_consumptions_state_check"
    CHECK (
      ("status" = 'READY' AND "consumed_at" IS NULL
        AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL
        AND "failed_at" IS NULL)
      OR
      ("status" = 'LEASED' AND "consumed_at" IS NULL
        AND "lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL
        AND "failed_at" IS NULL)
      OR
      ("status" = 'PROCESSED' AND "consumed_at" IS NOT NULL
        AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL
        AND "failed_at" IS NULL)
      OR
      ("status" = 'FAILED' AND "consumed_at" IS NULL
        AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL
        AND "failed_at" IS NOT NULL)
    );

CREATE INDEX "platform_outbox_consumptions_status_available_idx"
  ON "platform_outbox_consumptions" ("consumer_name", "status", "available_at");

CREATE INDEX "platform_outbox_consumptions_lease_expiry_idx"
  ON "platform_outbox_consumptions" ("lease_expires_at");
