ALTER TABLE "platform_outbox_events"
ADD COLUMN IF NOT EXISTS "envelope_version" INTEGER;

UPDATE "platform_outbox_events"
SET "envelope_version" = 1
WHERE "envelope_version" IS NULL;

ALTER TABLE "platform_outbox_events"
ALTER COLUMN "envelope_version" SET NOT NULL;
