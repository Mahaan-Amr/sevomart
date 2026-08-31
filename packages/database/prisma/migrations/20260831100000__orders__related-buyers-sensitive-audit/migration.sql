CREATE TABLE "order_fulfillment_status_projections" (
  "order_id" UUID NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "version" INTEGER NOT NULL,
  "accepted_event_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "order_fulfillment_status_projections_pkey" PRIMARY KEY ("order_id"),
  CONSTRAINT "order_fulfillment_status_projections_event_key"
    UNIQUE ("accepted_event_id"),
  CONSTRAINT "order_fulfillment_status_projections_status_check"
    CHECK ("status" IN ('ACTION_REQUIRED', 'PREPARING', 'SHIPPED', 'DELIVERED')),
  CONSTRAINT "order_fulfillment_status_projections_version_check"
    CHECK ("version" > 0)
);

CREATE TABLE "order_sensitive_access_audit" (
  "id" UUID NOT NULL,
  "actor_identity_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "action" VARCHAR(48) NOT NULL,
  "reason_code" VARCHAR(48) NOT NULL,
  "reason_hash" CHAR(64) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "order_sensitive_access_audit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_sensitive_access_audit_action_check"
    CHECK ("action" = 'REVEAL_DELIVERY_DETAILS'),
  CONSTRAINT "order_sensitive_access_audit_reason_check"
    CHECK (
      "reason_code" = 'ORDER_FOLLOW_UP' AND "reason_hash" IS NOT NULL
    )
);

CREATE INDEX "order_sensitive_access_audit_order_time_idx"
  ON "order_sensitive_access_audit" ("order_id", "occurred_at" DESC);
CREATE INDEX "order_sensitive_access_audit_actor_time_idx"
  ON "order_sensitive_access_audit" ("actor_identity_id", "occurred_at" DESC);

CREATE FUNCTION "orders_reject_sensitive_access_audit_change"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'order_sensitive_access_audit is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "order_sensitive_access_audit_immutable"
BEFORE UPDATE OR DELETE ON "order_sensitive_access_audit"
FOR EACH ROW EXECUTE FUNCTION "orders_reject_sensitive_access_audit_change"();
