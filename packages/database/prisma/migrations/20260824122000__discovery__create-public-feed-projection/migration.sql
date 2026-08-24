CREATE TABLE "discovery_store_feed_projections" (
  "store_id" UUID PRIMARY KEY,
  "published" BOOLEAN NOT NULL,
  "aggregate_version" INTEGER NOT NULL,
  "publication_version" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "discovery_store_feed_projection_version_check"
    CHECK ("aggregate_version" > 0 AND "publication_version" >= 0)
);

CREATE INDEX "discovery_store_feed_projections_published_store_id_idx"
ON "discovery_store_feed_projections" ("published", "store_id");

CREATE TABLE "discovery_product_feed_projections" (
  "product_id" UUID PRIMARY KEY,
  "store_id" UUID NOT NULL,
  "product_aggregate_version" INTEGER NOT NULL,
  "publication_version" INTEGER NOT NULL,
  "published" BOOLEAN NOT NULL,
  "first_published_at" TIMESTAMPTZ(3) NOT NULL,
  "eligible_since" TIMESTAMPTZ(3) NOT NULL,
  "offer_version" INTEGER NOT NULL,
  "availability_version" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "discovery_product_feed_projection_versions_check" CHECK (
    "product_aggregate_version" > 0 AND
    "publication_version" > 0 AND
    "offer_version" > 0 AND
    "availability_version" >= 0
  )
);

CREATE INDEX "discovery_product_feed_projections_published_rank_idx"
ON "discovery_product_feed_projections"
  ("published", "first_published_at" DESC, "product_id");

CREATE INDEX "discovery_product_feed_projections_store_published_idx"
ON "discovery_product_feed_projections" ("store_id", "published");

CREATE TABLE "discovery_product_feed_version_buffers" (
  "product_id" UUID NOT NULL,
  "publication_version" INTEGER NOT NULL,
  "version_kind" VARCHAR(16) NOT NULL,
  "version" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "discovery_product_feed_version_buffers_pkey"
    PRIMARY KEY ("product_id", "publication_version", "version_kind"),
  CONSTRAINT "discovery_product_feed_version_buffers_kind_check"
    CHECK ("version_kind" IN ('OFFER', 'AVAILABILITY')),
  CONSTRAINT "discovery_product_feed_version_buffers_version_check"
    CHECK ("publication_version" > 0 AND "version" >= 0)
);

CREATE TABLE "discovery_projection_status" (
  "projection_name" VARCHAR(64) PRIMARY KEY,
  "healthy" BOOLEAN NOT NULL,
  "reason" VARCHAR(64),
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);

INSERT INTO "discovery_projection_status"
  ("projection_name", "healthy", "reason", "updated_at")
VALUES ('public-feed-v1', TRUE, NULL, CURRENT_TIMESTAMP);
