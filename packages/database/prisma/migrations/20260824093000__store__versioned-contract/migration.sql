ALTER TABLE "store_stores"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "return_policy_revision" INTEGER NOT NULL DEFAULT 0;

UPDATE "store_stores"
SET "revision" = 1,
    "return_policy_revision" = CASE WHEN "return_policy" IS NULL THEN 0 ELSE 1 END;

ALTER TABLE "store_stores"
  ADD CONSTRAINT "store_stores_revision_check" CHECK ("revision" >= 0),
  ADD CONSTRAINT "store_stores_return_policy_revision_check"
    CHECK ("return_policy_revision" >= 0);

ALTER TABLE "store_shipping_methods"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "fixed_fee_amount" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'IRR',
  ADD COLUMN "estimated_delivery_text" VARCHAR(120) NOT NULL
    DEFAULT 'زمان دقیق ارسال هنگام ثبت سفارش مشخص می‌شود.',
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "requires_delivery_address" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "requires_postal_code" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "store_shipping_methods"
SET "requires_delivery_address" = ("code" <> 'PICKUP'),
    "requires_postal_code" = ("code" = 'NATIONAL_POST');

ALTER TABLE "store_shipping_methods"
  ADD CONSTRAINT "store_shipping_methods_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "store_shipping_methods_fixed_fee_check"
    CHECK ("fixed_fee_amount" >= 0 AND "fixed_fee_amount" % 10 = 0),
  ADD CONSTRAINT "store_shipping_methods_currency_check" CHECK ("currency" = 'IRR');

CREATE UNIQUE INDEX "store_memberships_one_owner_per_store_key"
  ON "store_memberships"("store_id") WHERE "role" = 'OWNER';

CREATE TABLE "store_idempotency_records" (
  "operation" VARCHAR(80) NOT NULL,
  "actor_identity_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "response_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_idempotency_records_pkey"
    PRIMARY KEY ("operation", "actor_identity_id", "idempotency_key")
);
