CREATE TABLE "discovery_follower_count_relation_projections" (
  "relation_id" UUID PRIMARY KEY,
  "identity_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "relation_revision" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "discovery_follower_count_relation_status_check"
    CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "discovery_follower_count_relation_revision_check"
    CHECK ("relation_revision" > 0)
);

CREATE INDEX "discovery_follower_count_relation_identity_status_idx"
ON "discovery_follower_count_relation_projections" ("identity_id", "status");

CREATE INDEX "discovery_follower_count_relation_store_status_idx"
ON "discovery_follower_count_relation_projections" ("store_id", "status");

INSERT INTO "discovery_follower_count_relation_projections"
  ("relation_id", "identity_id", "store_id", "status", "relation_revision",
   "updated_at")
SELECT "relation_id", "identity_id", "store_id", "status", "revision", "updated_at"
FROM "discovery_store_follows";

DELETE FROM "discovery_public_follower_counts";

INSERT INTO "discovery_public_follower_counts"
  ("store_id", "follower_count", "updated_at")
SELECT relation."store_id", count(*)::integer, max(relation."updated_at")
FROM "discovery_follower_count_relation_projections" relation
JOIN "discovery_identity_status_projections" identity
  ON identity."identity_id" = relation."identity_id"
WHERE relation."status" = 'ACTIVE' AND identity."status" = 'ACTIVE'
GROUP BY relation."store_id";
