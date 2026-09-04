create table content_public_sales_contents (
  content_id uuid primary key,
  store_id uuid not null,
  source text not null check (source = 'SELLER'),
  moderation_state text not null check (moderation_state = 'PUBLISHED'),
  media_id uuid not null,
  media_kind text not null check (media_kind in ('IMAGE', 'VIDEO')),
  aggregate_version bigint not null check (aggregate_version > 0),
  published_at timestamptz not null,
  updated_at timestamptz not null
);

create index content_public_sales_contents_store_published_idx
  on content_public_sales_contents (store_id, published_at desc, content_id desc);

create table content_public_product_states (
  product_id uuid primary key,
  aggregate_version bigint not null check (aggregate_version > 0),
  publication_version bigint not null check (publication_version >= 0),
  active boolean not null,
  updated_at timestamptz not null
);

create table content_public_store_states (
  store_id uuid primary key,
  aggregate_version bigint not null check (aggregate_version > 0),
  publication_version bigint not null check (publication_version >= 0),
  published boolean not null,
  updated_at timestamptz not null
);

create table content_public_sales_content_products (
  content_id uuid not null references content_public_sales_contents(content_id)
    on delete cascade,
  product_id uuid not null,
  active boolean not null,
  last_product_aggregate_version bigint not null default 0
    check (last_product_aggregate_version >= 0),
  last_product_occurred_at timestamptz not null,
  primary key (content_id, product_id)
);

create index content_public_sales_content_products_product_idx
  on content_public_sales_content_products (product_id);

create table content_public_sales_content_status (
  projection_name text primary key,
  updated_at timestamptz not null,
  constraint content_public_sales_content_status_singleton
    check (projection_name = 'public-sales-content-v2')
);

insert into content_public_sales_content_status (projection_name, updated_at)
values ('public-sales-content-v2', now());
