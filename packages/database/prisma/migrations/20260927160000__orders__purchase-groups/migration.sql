create table order_purchase_group_preparations (
  checkout_revision uuid primary key,
  identity_id uuid not null,
  cart_id uuid not null,
  cart_revision integer not null,
  snapshot jsonb not null,
  expires_at timestamptz(3) not null,
  consumed_group_id uuid unique,
  created_at timestamptz(3) not null default now()
);
create index order_purchase_group_preparations_identity_expiry_idx
  on order_purchase_group_preparations(identity_id, expires_at);

create table order_purchase_groups (
  id uuid primary key,
  identity_id uuid not null,
  cart_id uuid not null,
  checkout_revision uuid not null unique,
  idempotency_key varchar(200) not null,
  status varchar(32) not null,
  total_amount bigint not null check (total_amount >= 0),
  currency char(3) not null default 'IRR',
  review_snapshot jsonb not null,
  reservation_expires_at timestamptz(3) not null,
  created_at timestamptz(3) not null default now(),
  paid_at timestamptz(3)
);
create index order_purchase_groups_buyer_created_idx
  on order_purchase_groups(identity_id, created_at);
create unique index order_purchase_groups_idempotency_idx
  on order_purchase_groups(identity_id, idempotency_key);

alter table order_orders add column purchase_group_id uuid;
create index order_orders_purchase_group_idx on order_orders(purchase_group_id);

create table order_purchase_group_dev_attempts (
  id uuid primary key,
  group_id uuid not null,
  identity_id uuid not null,
  idempotency_key varchar(200) not null,
  status varchar(24) not null,
  amount bigint not null check (amount >= 0),
  currency char(3) not null default 'IRR',
  provider varchar(24) not null,
  provider_reference varchar(128) unique,
  created_at timestamptz(3) not null default now(),
  confirmed_at timestamptz(3)
);
create index order_purchase_group_dev_attempts_identity_idx on order_purchase_group_dev_attempts(identity_id, created_at);
create unique index order_purchase_group_dev_attempts_idempotency_idx
  on order_purchase_group_dev_attempts(identity_id, idempotency_key);
create unique index order_purchase_group_dev_attempts_active_group_idx
  on order_purchase_group_dev_attempts(group_id)
  where status in ('CREATED', 'CONFIRMED', 'REVIEW_REQUIRED');
