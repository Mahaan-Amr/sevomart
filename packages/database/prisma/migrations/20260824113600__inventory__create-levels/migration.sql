CREATE TABLE "inventory_levels" (
  "variant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "on_hand" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("variant_id"),
  CONSTRAINT "inventory_levels_on_hand_check" CHECK ("on_hand" >= 0)
);

CREATE INDEX "inventory_levels_store_id_idx" ON "inventory_levels"("store_id");
