CREATE TABLE "identity_seller_access" (
  "id" UUID NOT NULL,
  "identity_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "identity_seller_access_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_seller_access_status_check"
    CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'REVOKED'))
);

CREATE UNIQUE INDEX "identity_seller_access_identity_key"
ON "identity_seller_access"("identity_id");
