create table "order_carts" (
  "id" uuid primary key,
  "store_id" uuid not null,
  "identity_id" uuid,
  "status" varchar(16) not null default 'ACTIVE',
  "revision" integer not null default 0,
  "expires_at" timestamptz(3) not null,
  "created_at" timestamptz(3) not null default now(),
  "updated_at" timestamptz(3) not null default now(),
  constraint "order_carts_status_check"
    check ("status" in ('ACTIVE', 'MERGED', 'REPLACED', 'EXPIRED'))
);

create unique index "order_carts_one_active_identity"
  on "order_carts" ("identity_id")
  where "identity_id" is not null and "status" = 'ACTIVE';
create index "order_carts_identity_status_idx"
  on "order_carts" ("identity_id", "status");

create table "order_cart_items" (
  "cart_id" uuid not null references "order_carts" ("id") on delete cascade,
  "variant_id" uuid not null,
  "product_id" uuid not null,
  "quantity" integer not null,
  "created_at" timestamptz(3) not null default now(),
  "updated_at" timestamptz(3) not null default now(),
  primary key ("cart_id", "variant_id"),
  constraint "order_cart_items_quantity_check" check ("quantity" between 1 and 99)
);

create table "order_cart_access_tokens" (
  "id" uuid primary key,
  "cart_id" uuid not null references "order_carts" ("id") on delete cascade,
  "token_hash" char(64) not null unique,
  "expires_at" timestamptz(3) not null,
  "revoked_at" timestamptz(3),
  "created_at" timestamptz(3) not null default now()
);
create index "order_cart_access_tokens_cart_expiry_idx"
  on "order_cart_access_tokens" ("cart_id", "expires_at");

create table "order_cart_idempotency_records" (
  "operation" varchar(48) not null,
  "scope" varchar(128) not null,
  "key" varchar(200) not null,
  "request_hash" char(64) not null,
  "response_json" jsonb not null,
  "created_at" timestamptz(3) not null default now(),
  primary key ("operation", "scope", "key")
);
