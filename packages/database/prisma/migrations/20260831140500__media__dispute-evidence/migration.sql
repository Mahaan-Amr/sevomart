ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_purpose_check";
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_purpose_check"
  CHECK ("purpose" IN ('STORE_LOGO', 'STORE_COVER', 'PRODUCT_IMAGE', 'CONVERSATION_ATTACHMENT', 'DISPUTE_EVIDENCE'));
ALTER TABLE "media_assets" ADD CONSTRAINT "media_dispute_evidence_private"
  CHECK ("purpose" <> 'DISPUTE_EVIDENCE' OR ("visibility" = 'PRIVATE' AND "owner_reference_id" IS NOT NULL));
