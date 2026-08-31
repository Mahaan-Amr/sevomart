CREATE TABLE "reporting_fulfillment_states" (
    "order_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "last_event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "projected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reporting_fulfillment_states_pkey" PRIMARY KEY ("order_id"),
    CONSTRAINT "reporting_fulfillment_states_status_check" CHECK
      ("status" IN ('PREPARING', 'SHIPPED', 'DELIVERED')),
    CONSTRAINT "reporting_fulfillment_states_version_check" CHECK
      ("aggregate_version" > 1)
);

CREATE UNIQUE INDEX "reporting_fulfillment_states_last_event_id_key"
ON "reporting_fulfillment_states"("last_event_id");

CREATE INDEX "reporting_fulfillment_states_status_occurred_idx"
ON "reporting_fulfillment_states"("status", "occurred_at");

CREATE TABLE "reporting_seller_order_facts" (
    "order_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "last_event_id" UUID NOT NULL,
    "projected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reporting_seller_order_facts_pkey" PRIMARY KEY ("order_id"),
    CONSTRAINT "reporting_seller_order_facts_total_check" CHECK
      ("total_amount" >= 0 AND "total_amount" % 10 = 0),
    CONSTRAINT "reporting_seller_order_facts_currency_check" CHECK
      ("currency" = 'IRR'),
    CONSTRAINT "reporting_seller_order_facts_version_check" CHECK
      ("aggregate_version" > 0)
);

CREATE UNIQUE INDEX "reporting_seller_order_facts_last_event_id_key"
ON "reporting_seller_order_facts"("last_event_id");

CREATE INDEX "reporting_seller_order_facts_store_paid_idx"
ON "reporting_seller_order_facts"("store_id", "paid_at");

CREATE TABLE "reporting_seller_dispute_states" (
    "dispute_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "deadline_at" TIMESTAMPTZ(3),
    "aggregate_version" INTEGER NOT NULL,
    "last_event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "projected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reporting_seller_dispute_states_pkey" PRIMARY KEY ("dispute_id"),
    CONSTRAINT "reporting_seller_dispute_states_status_check" CHECK
      ("status" IN ('AWAITING_SELLER_RESPONSE', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED')),
    CONSTRAINT "reporting_seller_dispute_states_version_check" CHECK
      ("aggregate_version" > 0)
);

CREATE UNIQUE INDEX "reporting_seller_dispute_states_last_event_id_key"
ON "reporting_seller_dispute_states"("last_event_id");

CREATE INDEX "reporting_seller_dispute_states_store_status_idx"
ON "reporting_seller_dispute_states"("store_id", "status");
