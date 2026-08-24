ALTER TABLE "identity_seller_applications"
ADD COLUMN "aggregate_version" INTEGER;

UPDATE "identity_seller_applications"
SET "aggregate_version" = "current_revision";

ALTER TABLE "identity_seller_applications"
ALTER COLUMN "aggregate_version" SET NOT NULL;

ALTER TABLE "identity_seller_applications"
ADD CONSTRAINT "identity_seller_applications_aggregate_version_check"
CHECK ("aggregate_version" > 0);
