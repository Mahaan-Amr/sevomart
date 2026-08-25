alter table inventory_reservations
  add column payment_attempt_id uuid,
  add column hold_lease_until timestamptz(3),
  add constraint inventory_reservation_hold_pair_check
    check ((payment_attempt_id is null) = (hold_lease_until is null));

alter table order_orders add column paid_at timestamptz(3);

create table payment_attempts (
  id uuid primary key,
  order_id uuid not null references order_orders(id) on delete restrict,
  identity_id uuid not null,
  status varchar(24) not null
    check (status in ('CREATED', 'DISPATCHED', 'CONFIRMED')),
  amount bigint not null check (amount >= 0 and amount % 10 = 0),
  currency char(3) not null default 'IRR' check (currency = 'IRR'),
  provider varchar(24) not null,
  provider_reference varchar(128) unique,
  redirect_url varchar(500),
  created_at timestamptz(3) not null default now(),
  dispatched_at timestamptz(3),
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
  result varchar(24) not null check (result = 'CONFIRMED'),
  observed_at timestamptz(3) not null default now(),
  correlation_id varchar(128) not null,
  primary key (provider, provider_event_id)
);
