ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_purpose_check";
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_purpose_check"
  CHECK ("purpose" IN ('STORE_LOGO', 'STORE_COVER', 'PRODUCT_IMAGE'));

ALTER TABLE "media_variants" DROP CONSTRAINT "media_variants_name_check";
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_name_check"
  CHECK (
    "name" IN (
      'logo-small', 'logo-large', 'cover-mobile', 'cover-desktop',
      'product-card', 'product-detail'
    )
  );
