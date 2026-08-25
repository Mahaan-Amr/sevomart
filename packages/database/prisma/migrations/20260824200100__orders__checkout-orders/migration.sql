alter table order_carts drop constraint order_carts_status_check;
alter table order_carts add constraint order_carts_status_check
  check (status in ('ACTIVE', 'MERGED', 'REPLACED', 'EXPIRED', 'CONVERTED'));

create table order_checkout_preparations (
  checkout_revision uuid primary key,
  identity_id uuid not null,
  cart_id uuid not null references order_carts(id) on delete restrict,
  cart_revision integer not null check (cart_revision >= 0),
  address_id uuid,
  address_revision integer,
  shipping_method_id uuid not null,
  shipping_revision integer not null check (shipping_revision > 0),
  policy_revision integer not null check (policy_revision > 0),
  snapshot jsonb not null,
  expires_at timestamptz(3) not null,
  consumed_order_id uuid unique,
  created_at timestamptz(3) not null default now(),
  check ((address_id is null) = (address_revision is null))
);

create index order_checkout_preparations_identity_expiry_idx
  on order_checkout_preparations (identity_id, expires_at);

create table order_orders (
  id uuid primary key,
  identity_id uuid not null,
  store_id uuid not null,
  checkout_revision uuid not null unique references order_checkout_preparations(checkout_revision),
  reservation_id uuid not null unique,
  status varchar(32) not null default 'PENDING_PAYMENT'
    check (status in ('PENDING_PAYMENT', 'PAID', 'PAYMENT_REVIEW', 'EXPIRED')),
  total_amount bigint not null check (total_amount >= 0 and total_amount % 10 = 0),
  currency char(3) not null default 'IRR' check (currency = 'IRR'),
  reservation_expires_at timestamptz(3) not null,
  review_snapshot jsonb not null,
  created_at timestamptz(3) not null default now()
);

alter table order_checkout_preparations
  add constraint order_checkout_consumed_order_fk
  foreign key (consumed_order_id) references order_orders(id) on delete restrict;

create index order_orders_identity_created_idx on order_orders (identity_id, created_at desc);

create table order_items (
  order_id uuid not null references order_orders(id) on delete restrict,
  variant_id uuid not null,
  product_id uuid not null,
  name varchar(120) not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price_amount bigint not null check (unit_price_amount >= 0 and unit_price_amount % 10 = 0),
  publication_version integer not null check (publication_version > 0),
  primary key (order_id, variant_id)
);

create table order_delivery_snapshots (
  order_id uuid primary key references order_orders(id) on delete restrict,
  address_id uuid not null,
  address_revision integer not null check (address_revision > 0),
  recipient_name varchar(120) not null,
  recipient_mobile varchar(11) not null,
  province_text varchar(80) not null,
  city_text varchar(80) not null,
  address_line varchar(500) not null,
  postal_code char(10)
);

create table order_shipping_snapshots (
  order_id uuid primary key references order_orders(id) on delete restrict,
  shipping_method_id uuid not null,
  shipping_method_revision integer not null check (shipping_method_revision > 0),
  code varchar(24) not null,
  label varchar(60) not null,
  fee_amount bigint not null check (fee_amount >= 0 and fee_amount % 10 = 0),
  estimated_delivery_text varchar(120) not null
);

create table order_policy_snapshots (
  order_id uuid primary key references order_orders(id) on delete restrict,
  revision integer not null check (revision > 0),
  text varchar(1000) not null
);

create table order_create_idempotency_records (
  identity_id uuid not null,
  key varchar(200) not null,
  request_hash char(64) not null,
  state varchar(16) not null,
  locked_until timestamptz(3) not null,
  response_json jsonb,
  completed_at timestamptz(3),
  created_at timestamptz(3) not null default now(),
  check (state in ('IN_PROGRESS', 'COMPLETED')),
  primary key (identity_id, key)
);
