CREATE TABLE "store_stores" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80),
    "slug" VARCHAR(48),
    "bio" VARCHAR(240),
    "return_policy" VARCHAR(1000),
    "settlement_kind" VARCHAR(16),
    "settlement_status" VARCHAR(24),
    "settlement_verified_at" TIMESTAMPTZ(3),
    "logo_media_id" UUID,
    "cover_media_id" UUID,
    "theme_color" CHAR(7),
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_stores_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_stores_slug_key" ON "store_stores"("slug");

CREATE TABLE "store_memberships" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "role" VARCHAR(16) NOT NULL DEFAULT 'OWNER',
    CONSTRAINT "store_memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "store_memberships_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store_stores"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "store_memberships_store_id_seller_id_key" ON "store_memberships"("store_id", "seller_id");
CREATE INDEX "store_memberships_seller_id_idx" ON "store_memberships"("seller_id");

CREATE TABLE "store_shipping_methods" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    CONSTRAINT "store_shipping_methods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "store_shipping_methods_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store_stores"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "store_shipping_methods_store_id_position_key" ON "store_shipping_methods"("store_id", "position");
