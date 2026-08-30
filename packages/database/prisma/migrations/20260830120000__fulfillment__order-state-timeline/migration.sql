CREATE TABLE "fulfillment_orders" (
    "order_id" UUID NOT NULL,
    "store_id" UUID,
    "status" VARCHAR(32) NOT NULL,
    "version" INTEGER NOT NULL,
    "accepted_event_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fulfillment_orders_pkey" PRIMARY KEY ("order_id"),
    CONSTRAINT "fulfillment_orders_status_check" CHECK
      ("status" IN ('ACTION_REQUIRED', 'PREPARING', 'SHIPPED', 'DELIVERED')),
    CONSTRAINT "fulfillment_orders_version_check" CHECK ("version" > 0),
    CONSTRAINT "fulfillment_orders_store_check" CHECK
      (("status" = 'ACTION_REQUIRED' AND "store_id" IS NULL) OR
       ("status" <> 'ACTION_REQUIRED' AND "store_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "fulfillment_orders_accepted_event_id_key"
ON "fulfillment_orders"("accepted_event_id");

CREATE TABLE "fulfillment_timeline_entries" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "actor_type" VARCHAR(16) NOT NULL,
    "actor_id" UUID,
    "correlation_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "shipping_method" VARCHAR(80),
    "tracking_code" VARCHAR(100),

    CONSTRAINT "fulfillment_timeline_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fulfillment_timeline_status_check" CHECK
      ("status" IN ('ACTION_REQUIRED', 'PREPARING', 'SHIPPED', 'DELIVERED')),
    CONSTRAINT "fulfillment_timeline_actor_check" CHECK
      (("actor_type" = 'SYSTEM' AND "actor_id" IS NULL) OR
       ("actor_type" = 'IDENTITY' AND "actor_id" IS NOT NULL)),
    CONSTRAINT "fulfillment_timeline_shipping_check" CHECK
      (("status" = 'SHIPPED' AND "shipping_method" IS NOT NULL) OR
       ("status" <> 'SHIPPED' AND "shipping_method" IS NULL AND "tracking_code" IS NULL)),
    CONSTRAINT "fulfillment_timeline_entries_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "fulfillment_orders"("order_id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "fulfillment_timeline_entries_order_id_version_key"
ON "fulfillment_timeline_entries"("order_id", "version");
CREATE INDEX "fulfillment_timeline_entries_order_id_occurred_at_idx"
ON "fulfillment_timeline_entries"("order_id", "occurred_at");

CREATE TABLE "fulfillment_idempotency_records" (
    "order_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_json" JSONB NOT NULL,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_idempotency_records_pkey"
      PRIMARY KEY ("order_id", "actor_id", "key")
);
