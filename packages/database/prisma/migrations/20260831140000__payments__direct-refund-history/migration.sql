-- Direct-settlement cancellations are seller-requested; only trusted provider
-- results finalize them. They do not imply a platform refund guarantee.
create table payment_direct_refunds (
  order_id uuid primary key,
  store_id uuid not null,
  payment_attempt_id uuid not null references payment_attempts(id) on delete restrict,
  amount bigint not null check (amount > 0),
  provider varchar(64) not null,
  status varchar(24) not null check (status in ('PENDING', 'FAILED', 'CONFIRMED')),
  version integer not null check (version > 0),
  reason varchar(500) not null,
  evidence_reference varchar(200),
  requested_by uuid not null,
  requested_at timestamptz(3) not null,
  updated_at timestamptz(3) not null
);

create index payment_direct_refunds_store_status_updated_idx
  on payment_direct_refunds (store_id, status, updated_at);

create table payment_direct_refund_audits (
  id uuid primary key,
  order_id uuid not null,
  version integer not null,
  from_status varchar(24),
  to_status varchar(24) not null,
  evidence_reference varchar(200),
  actor_kind varchar(24) not null check (actor_kind in ('SELLER', 'PROVIDER')),
  actor_reference varchar(200) not null,
  provider varchar(64),
  provider_event_id varchar(200),
  request_hash char(64),
  correlation_id uuid not null,
  occurred_at timestamptz(3) not null,
  unique (order_id, version)
);

create unique index payment_direct_refund_audits_provider_event_idx
  on payment_direct_refund_audits (provider, provider_event_id)
  where provider_event_id is not null;

create index payment_direct_refund_audits_order_occurred_idx
  on payment_direct_refund_audits (order_id, occurred_at);

create or replace function payment_reject_direct_refund_audit_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'payment_direct_refund_audits is append-only';
end;
$$;

create trigger payment_direct_refund_audits_immutable
before update or delete on payment_direct_refund_audits
for each row execute function payment_reject_direct_refund_audit_change();

create table payment_direct_refund_idempotency_records (
  operation varchar(32) not null,
  order_id uuid not null,
  scope varchar(200) not null,
  key varchar(200) not null,
  request_hash char(64) not null,
  response_json jsonb not null,
  created_at timestamptz(3) not null default now(),
  primary key (operation, order_id, scope, key)
);
