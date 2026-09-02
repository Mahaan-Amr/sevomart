ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_purpose_check";
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_purpose_check"
  CHECK ("purpose" IN ('STORE_LOGO', 'STORE_COVER', 'PRODUCT_IMAGE', 'CONVERSATION_ATTACHMENT', 'DISPUTE_EVIDENCE', 'PURCHASE_EXPERIENCE_IMAGE', 'BUYER_DISPUTE_EVIDENCE'));
ALTER TABLE "media_assets" ADD CONSTRAINT "media_buyer_dispute_evidence_private"
  CHECK ("purpose" <> 'BUYER_DISPUTE_EVIDENCE' OR ("visibility" = 'PRIVATE' AND "owner_reference_id" IS NOT NULL));

CREATE TABLE "media_buyer_dispute_upload_contexts" (
  "id" UUID PRIMARY KEY,
  "identity_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_buyer_dispute_context_identity_order_unique"
    UNIQUE ("identity_id", "order_id")
);

CREATE INDEX "media_buyer_dispute_context_expiry_idx"
  ON "media_buyer_dispute_upload_contexts" ("expires_at");

CREATE TABLE "media_buyer_dispute_upload_idempotency" (
  "context_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "media_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("context_id", "idempotency_key"),
  CONSTRAINT "media_buyer_dispute_idempotency_context_fk"
    FOREIGN KEY ("context_id") REFERENCES "media_buyer_dispute_upload_contexts" ("id") ON DELETE CASCADE,
  CONSTRAINT "media_buyer_dispute_idempotency_media_fk"
    FOREIGN KEY ("media_id") REFERENCES "media_assets" ("id") ON DELETE CASCADE
);
