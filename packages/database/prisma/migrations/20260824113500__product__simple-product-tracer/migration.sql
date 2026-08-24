CREATE TABLE "product_products" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "state" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "publication_version" INTEGER NOT NULL DEFAULT 0,
  "published_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_products_state_check" CHECK ("state" IN ('DRAFT', 'PUBLISHED'))
);

CREATE INDEX "product_products_store_id_state_idx"
  ON "product_products"("store_id", "state");

CREATE TABLE "product_working_copies" (
  "product_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(2000) NOT NULL,
  "media_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  CONSTRAINT "product_working_copies_pkey" PRIMARY KEY ("product_id"),
  CONSTRAINT "product_working_copies_variant_id_key" UNIQUE ("variant_id"),
  CONSTRAINT "product_working_copies_product_id_fkey" FOREIGN KEY ("product_id")
    REFERENCES "product_products"("id") ON DELETE CASCADE
);

CREATE TABLE "product_publications" (
  "product_id" UUID NOT NULL,
  "publication_version" INTEGER NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(2000) NOT NULL,
  "media_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_publications_pkey" PRIMARY KEY ("product_id", "publication_version"),
  CONSTRAINT "product_publications_product_id_fkey" FOREIGN KEY ("product_id")
    REFERENCES "product_products"("id") ON DELETE CASCADE
);

CREATE TABLE "product_offers" (
  "product_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "amount" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'IRR',
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "product_offers_pkey" PRIMARY KEY ("variant_id"),
  CONSTRAINT "product_offers_product_id_key" UNIQUE ("product_id"),
  CONSTRAINT "product_offers_product_id_fkey" FOREIGN KEY ("product_id")
    REFERENCES "product_products"("id") ON DELETE CASCADE,
  CONSTRAINT "product_offers_amount_check" CHECK ("amount" > 0 AND "amount" % 10 = 0),
  CONSTRAINT "product_offers_currency_check" CHECK ("currency" = 'IRR')
);

CREATE TABLE "product_idempotency_records" (
  "operation" VARCHAR(48) NOT NULL,
  "actor_identity_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "response_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_idempotency_records_pkey"
    PRIMARY KEY ("operation", "actor_identity_id", "idempotency_key")
);

CREATE TABLE "inventory_levels" (
  "variant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "on_hand" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("variant_id"),
  CONSTRAINT "inventory_levels_on_hand_check" CHECK ("on_hand" >= 0)
);

CREATE INDEX "inventory_levels_store_id_idx" ON "inventory_levels"("store_id");
