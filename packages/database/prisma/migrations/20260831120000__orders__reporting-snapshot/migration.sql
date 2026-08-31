WITH paid_orders AS (
  SELECT "id", "store_id", "total_amount", "currency",
    COALESCE("paid_at", "created_at") AS "paid_at",
    gen_random_uuid() AS "event_id",
    gen_random_uuid() AS "correlation_id",
    gen_random_uuid() AS "causation_id"
  FROM "order_orders"
  WHERE "status" = 'PAID'
)
INSERT INTO "platform_outbox_events"
  ("event_id", "envelope_version", "event_type", "aggregate_id",
   "aggregate_version", "occurred_at", "correlation_id", "causation_id",
   "actor_type", "actor_id", "payload", "available_at")
SELECT "event_id", 1, 'OrderReportingSnapshot.v1', "id", 2, "paid_at",
  "correlation_id", "causation_id", 'SYSTEM', NULL,
  jsonb_build_object(
    'storeId', "store_id",
    'status', 'PAID',
    'total', jsonb_build_object('amount', "total_amount", 'currency', "currency"),
    'paidAt', to_char("paid_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ),
  "paid_at"
FROM paid_orders;
