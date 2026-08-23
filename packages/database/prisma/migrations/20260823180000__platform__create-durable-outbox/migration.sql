CREATE TABLE "platform_outbox_events" (
  "event_id" UUID NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "aggregate_version" INTEGER NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "causation_id" UUID,
  "actor_type" VARCHAR(16) NOT NULL,
  "actor_id" UUID,
  "payload" JSONB NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'READY',
  "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" UUID,
  "lease_expires_at" TIMESTAMPTZ(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(500),
  "failed_at" TIMESTAMPTZ(3),
  "processed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_outbox_events_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "platform_outbox_actor_check" CHECK (
    ("actor_type" = 'IDENTITY' AND "actor_id" IS NOT NULL)
    OR ("actor_type" = 'SYSTEM' AND "actor_id" IS NULL)
  ),
  CONSTRAINT "platform_outbox_status_check" CHECK (
    "status" IN ('READY', 'LEASED', 'PROCESSED', 'FAILED')
  )
);

CREATE INDEX "platform_outbox_events_status_available_at_idx"
  ON "platform_outbox_events"("status", "available_at");
CREATE INDEX "platform_outbox_events_lease_expires_at_idx"
  ON "platform_outbox_events"("lease_expires_at");

CREATE TABLE "platform_outbox_consumptions" (
  "consumer_name" VARCHAR(120) NOT NULL,
  "event_id" UUID NOT NULL,
  "consumed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_outbox_consumptions_pkey"
    PRIMARY KEY ("consumer_name", "event_id")
);
