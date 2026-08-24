ALTER TABLE "product_working_copies"
  ALTER COLUMN "variant_id" DROP NOT NULL,
  ADD COLUMN "definition" JSONB;

ALTER TABLE "product_publications"
  ADD COLUMN "snapshot" JSONB;

ALTER TABLE "product_offers"
  DROP CONSTRAINT "product_offers_product_id_key",
  ADD COLUMN "sku" VARCHAR(100);

CREATE INDEX "product_offers_product_id_idx"
  ON "product_offers"("product_id");

CREATE TABLE "product_variants" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "client_key" VARCHAR(100) NOT NULL,
  "combination_key" VARCHAR(500) NOT NULL,
  "retired" BOOLEAN NOT NULL DEFAULT false,
  "ever_published" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id")
    REFERENCES "product_products"("id") ON DELETE CASCADE,
  CONSTRAINT "product_variants_product_id_client_key_key"
    UNIQUE ("product_id", "client_key"),
  CONSTRAINT "product_variants_product_id_combination_key_key"
    UNIQUE ("product_id", "combination_key")
);

CREATE INDEX "product_variants_store_id_idx" ON "product_variants"("store_id");

INSERT INTO "product_variants"
  ("id", "product_id", "store_id", "client_key", "combination_key")
SELECT working."variant_id", working."product_id", product."store_id", 'simple', ''
FROM "product_working_copies" working
JOIN "product_products" product ON product."id" = working."product_id"
WHERE working."variant_id" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "product_sku_history" (
  "store_id" UUID NOT NULL,
  "sku" VARCHAR(100) NOT NULL,
  "variant_id" UUID NOT NULL,
  "first_used" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_sku_history_pkey" PRIMARY KEY ("store_id", "sku")
);

CREATE INDEX "product_sku_history_variant_id_idx"
  ON "product_sku_history"("variant_id");
