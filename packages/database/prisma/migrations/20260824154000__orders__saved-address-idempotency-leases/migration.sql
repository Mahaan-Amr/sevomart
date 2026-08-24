alter table "order_saved_address_idempotency_records"
  add column "state" varchar(16),
  add column "locked_until" timestamptz(3),
  add column "completed_at" timestamptz(3),
  alter column "response_json" drop not null;

update "order_saved_address_idempotency_records"
set "state" = 'COMPLETED',
    "locked_until" = "created_at",
    "completed_at" = "created_at";

alter table "order_saved_address_idempotency_records"
  alter column "state" set not null,
  alter column "locked_until" set not null,
  add constraint "order_saved_address_idempotency_state_check"
    check ("state" in ('IN_PROGRESS', 'COMPLETED'));
