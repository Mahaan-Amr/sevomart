CREATE TABLE content_sales_contents (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL,
  actor_identity_id uuid NOT NULL,
  source varchar(24) NOT NULL DEFAULT 'SELLER' CHECK (source = 'SELLER'),
  moderation_state varchar(16) NOT NULL DEFAULT 'PUBLISHED'
    CHECK (moderation_state IN ('PUBLISHED', 'HIDDEN')),
  media_id uuid NOT NULL,
  media_kind varchar(8) NOT NULL CHECK (media_kind IN ('IMAGE', 'VIDEO')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX content_sales_contents_store_created_idx
  ON content_sales_contents (store_id, created_at);

CREATE TABLE content_sales_content_products (
  content_id uuid NOT NULL REFERENCES content_sales_contents(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  publication_version integer NOT NULL CHECK (publication_version > 0),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (content_id, product_id)
);
CREATE INDEX content_sales_content_products_product_active_idx
  ON content_sales_content_products (product_id, active);

CREATE TABLE content_product_states (
  product_id uuid PRIMARY KEY,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  publication_version integer NOT NULL CHECK (publication_version > 0),
  active boolean NOT NULL,
  updated_at timestamptz(3) NOT NULL
);

CREATE TABLE content_purchase_experiences (
  id uuid PRIMARY KEY,
  buyer_identity_id uuid NOT NULL,
  order_item_id uuid NOT NULL UNIQUE,
  store_id uuid NOT NULL,
  product_id uuid NOT NULL,
  source varchar(24) NOT NULL DEFAULT 'VERIFIED_PURCHASE'
    CHECK (source = 'VERIFIED_PURCHASE'),
  moderation_state varchar(16) NOT NULL DEFAULT 'PUBLISHED'
    CHECK (moderation_state IN ('PUBLISHED', 'HIDDEN')),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text varchar(2000) NOT NULL,
  media_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX content_purchase_experiences_store_product_created_idx
  ON content_purchase_experiences (store_id, product_id, created_at);

CREATE TABLE content_idempotency_records (
  operation varchar(48) NOT NULL,
  actor_id uuid NOT NULL,
  key varchar(200) NOT NULL,
  request_hash char(64) NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, actor_id, key)
);

CREATE TABLE content_audits (
  id uuid PRIMARY KEY,
  aggregate_kind varchar(32) NOT NULL,
  aggregate_id uuid NOT NULL,
  actor_identity_id uuid NOT NULL,
  operation varchar(48) NOT NULL,
  outcome varchar(16) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX content_audits_aggregate_created_idx
  ON content_audits (aggregate_kind, aggregate_id, created_at);
