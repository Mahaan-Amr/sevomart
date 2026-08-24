CREATE TABLE "discovery_store_follows" (
  "relation_id" UUID NOT NULL,
  "identity_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "revision" INTEGER NOT NULL,
  "activated_at" TIMESTAMPTZ(3) NOT NULL,
  "deactivated_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "discovery_store_follows_pkey" PRIMARY KEY ("identity_id", "store_id"),
  CONSTRAINT "discovery_store_follows_relation_id_key" UNIQUE ("relation_id"),
  CONSTRAINT "discovery_store_follows_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "discovery_store_follows_revision_check" CHECK ("revision" > 0)
);

CREATE INDEX "discovery_store_follows_store_id_status_idx"
ON "discovery_store_follows" ("store_id", "status");

CREATE TABLE "discovery_follow_sets" (
  "identity_id" UUID PRIMARY KEY,
  "revision" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "discovery_follow_sets_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "discovery_public_follower_counts" (
  "store_id" UUID PRIMARY KEY,
  "follower_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "discovery_public_follower_counts_nonnegative_check"
    CHECK ("follower_count" >= 0)
);

CREATE TABLE "discovery_identity_status_projections" (
  "identity_id" UUID PRIMARY KEY,
  "status" VARCHAR(16) NOT NULL,
  "status_version" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "discovery_identity_status_projections_status_check"
    CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "discovery_identity_status_projections_version_check"
    CHECK ("status_version" >= 0)
);

CREATE TABLE "discovery_follow_idempotency_records" (
  "operation" VARCHAR(32) NOT NULL,
  "identity_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "response_json" JSONB NOT NULL,
  "response_etag" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "discovery_follow_idempotency_records_pkey"
    PRIMARY KEY ("operation", "identity_id", "store_id", "idempotency_key")
);

CREATE TABLE "discovery_follow_audits" (
  "id" UUID PRIMARY KEY,
  "actor_identity_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "previous_status" VARCHAR(16),
  "next_status" VARCHAR(16) NOT NULL,
  "previous_revision" INTEGER,
  "next_revision" INTEGER NOT NULL,
  "correlation_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "discovery_follow_audits_previous_status_check"
    CHECK ("previous_status" IS NULL OR "previous_status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "discovery_follow_audits_next_status_check"
    CHECK ("next_status" IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX "discovery_follow_audits_store_id_occurred_at_idx"
ON "discovery_follow_audits" ("store_id", "occurred_at");
