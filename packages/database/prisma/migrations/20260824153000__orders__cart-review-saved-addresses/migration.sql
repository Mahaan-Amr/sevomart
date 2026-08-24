alter table "order_carts"
  add column "reviewed_policy_revision" integer not null default 0,
  add column "reviewed_shipping_hash" char(64) not null default '';

alter table "order_cart_items"
  add column "reviewed_publication_version" integer not null default 0,
  add column "reviewed_unit_price_amount" integer not null default 0;

create table "order_cart_audits" (
  "id" uuid primary key,
  "cart_id" uuid not null,
  "operation" varchar(48) not null,
  "actor_kind" varchar(16) not null,
  "actor_identity_id" uuid,
  "revision" integer not null,
  "correlation_id" varchar(128) not null,
  "created_at" timestamptz(3) not null default now(),
  constraint "order_cart_audits_actor_kind_check"
    check ("actor_kind" in ('GUEST', 'IDENTITY'))
);
create index "order_cart_audits_cart_created_idx"
  on "order_cart_audits" ("cart_id", "created_at");

create table "order_saved_addresses" (
  "id" uuid primary key,
  "identity_id" uuid not null,
  "current_revision" integer not null default 1,
  "status" varchar(16) not null default 'ACTIVE',
  "created_at" timestamptz(3) not null default now(),
  "updated_at" timestamptz(3) not null default now(),
  constraint "order_saved_addresses_status_check"
    check ("status" in ('ACTIVE', 'DELETED'))
);
create index "order_saved_addresses_identity_status_updated_idx"
  on "order_saved_addresses" ("identity_id", "status", "updated_at");

create table "order_saved_address_revisions" (
  "address_id" uuid not null references "order_saved_addresses" ("id") on delete restrict,
  "revision" integer not null,
  "recipient_name" varchar(80) not null,
  "recipient_mobile" varchar(11) not null,
  "province_text" varchar(80) not null,
  "city_text" varchar(80) not null,
  "address_line" varchar(500) not null,
  "postal_code" char(10),
  "created_at" timestamptz(3) not null default now(),
  primary key ("address_id", "revision")
);

create table "order_saved_address_idempotency_records" (
  "operation" varchar(48) not null,
  "identity_id" uuid not null,
  "key" varchar(200) not null,
  "request_hash" char(64) not null,
  "response_json" jsonb not null,
  "created_at" timestamptz(3) not null default now(),
  primary key ("operation", "identity_id", "key")
);

create table "order_saved_address_audits" (
  "id" uuid primary key,
  "address_id" uuid not null,
  "identity_id" uuid not null,
  "operation" varchar(24) not null,
  "revision" integer not null,
  "correlation_id" varchar(128) not null,
  "created_at" timestamptz(3) not null default now()
);
create index "order_saved_address_audits_address_created_idx"
  on "order_saved_address_audits" ("address_id", "created_at");
