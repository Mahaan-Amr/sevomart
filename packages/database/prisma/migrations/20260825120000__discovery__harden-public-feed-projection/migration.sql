ALTER TABLE "discovery_product_feed_projections"
ADD COLUMN "publication_updated_at" TIMESTAMPTZ(3);

UPDATE "discovery_product_feed_projections"
SET "publication_updated_at" = "eligible_since";

ALTER TABLE "discovery_product_feed_projections"
ALTER COLUMN "publication_updated_at" SET NOT NULL;
