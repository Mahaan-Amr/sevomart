create table payment_attempts (
  id uuid primary key,
  order_id uuid not null references order_orders(id) on delete restrict,
  identity_id uuid not null,
  status varchar(24) not null
    check (status in ('CREATED', 'DISPATCHED', 'CONFIRMED', 'FAILED', 'REVIEW_REQUIRED')),
  amount bigint not null check (amount >= 0 and amount % 10 = 0),
  currency char(3) not null default 'IRR' check (currency = 'IRR'),
  provider varchar(24) not null,
  provider_reference varchar(128) unique,
  redirect_url varchar(500),
  created_at timestamptz(3) not null default now(),
  dispatched_at timestamptz(3),
  dispatch_lease_until timestamptz(3),
  confirmed_at timestamptz(3)
);

create unique index payment_attempts_one_active_order_idx
  on payment_attempts (order_id)
  where status in ('CREATED', 'DISPATCHED', 'CONFIRMED');

create table payment_idempotency_records (
  identity_id uuid not null,
  key varchar(200) not null,
  request_hash char(64) not null,
  attempt_id uuid not null references payment_attempts(id) on delete restrict,
  created_at timestamptz(3) not null default now(),
  primary key (identity_id, key)
);

create table payment_provider_observations (
  provider varchar(24) not null,
  provider_event_id varchar(128) not null,
  attempt_id uuid not null references payment_attempts(id) on delete restrict,
  provider_reference varchar(128) not null,
  result varchar(24) not null check (result in ('CONFIRMED', 'FAILED', 'PENDING')),
  observed_at timestamptz(3) not null default now(),
  correlation_id varchar(128) not null,
  primary key (provider, provider_event_id)
);

create table payment_attempt_audits (
  id uuid primary key,
  attempt_id uuid not null references payment_attempts(id) on delete restrict,
  from_status varchar(24),
  to_status varchar(24) not null,
  reason_code varchar(64) not null,
  actor_kind varchar(32) not null,
  correlation_id varchar(128) not null,
  occurred_at timestamptz(3) not null default now()
);

create index payment_attempt_audits_attempt_occurred_idx
  on payment_attempt_audits (attempt_id, occurred_at);
