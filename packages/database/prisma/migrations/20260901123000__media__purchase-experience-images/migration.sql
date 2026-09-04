ALTER TABLE "media_assets" RENAME COLUMN "owner_seller_id" TO "owner_identity_id";
ALTER INDEX "media_assets_owner_seller_id_created_at_idx"
  RENAME TO "media_assets_owner_identity_id_created_at_idx";

ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_purpose_check";
ALTER TABLE "media_assets" ALTER COLUMN "purpose" TYPE VARCHAR(32);
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_purpose_check"
  CHECK ("purpose" IN ('STORE_LOGO', 'STORE_COVER', 'PRODUCT_IMAGE', 'CONVERSATION_ATTACHMENT', 'DISPUTE_EVIDENCE', 'PURCHASE_EXPERIENCE_IMAGE'));
ALTER TABLE "media_assets" ADD CONSTRAINT "media_purchase_experience_image_private"
  CHECK ("purpose" <> 'PURCHASE_EXPERIENCE_IMAGE' OR ("visibility" = 'PRIVATE' AND "owner_reference_id" IS NOT NULL));

CREATE TABLE "media_purchase_experience_upload_contexts" (
  "id" UUID PRIMARY KEY,
  "identity_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_purchase_experience_context_identity_order_unique"
    UNIQUE ("identity_id", "order_item_id")
);

CREATE INDEX "media_purchase_experience_context_expiry_idx"
  ON "media_purchase_experience_upload_contexts" ("expires_at");

CREATE TABLE "media_purchase_experience_upload_idempotency" (
  "context_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "media_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("context_id", "idempotency_key"),
  CONSTRAINT "media_purchase_experience_idempotency_context_fk"
    FOREIGN KEY ("context_id") REFERENCES "media_purchase_experience_upload_contexts" ("id") ON DELETE CASCADE,
  CONSTRAINT "media_purchase_experience_idempotency_media_fk"
    FOREIGN KEY ("media_id") REFERENCES "media_assets" ("id") ON DELETE CASCADE
);
