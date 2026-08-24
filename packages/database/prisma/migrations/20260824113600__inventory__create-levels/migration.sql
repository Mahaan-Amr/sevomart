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

CREATE TABLE "inventory_adjustments" (
  "id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "actor_identity_id" UUID NOT NULL,
  "reason_code" VARCHAR(32) NOT NULL,
  "previous_on_hand" INTEGER NOT NULL,
  "next_on_hand" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "correlation_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_adjustments_reason_code_check"
    CHECK ("reason_code" IN ('INITIAL_STOCK', 'MANUAL_COUNT', 'DAMAGED',
      'RETURNED_TO_STOCK', 'CORRECTION')),
  CONSTRAINT "inventory_adjustments_previous_on_hand_check"
    CHECK ("previous_on_hand" >= 0),
  CONSTRAINT "inventory_adjustments_next_on_hand_check"
    CHECK ("next_on_hand" >= 0),
  CONSTRAINT "inventory_adjustments_revision_check" CHECK ("revision" > 0)
);

CREATE INDEX "inventory_adjustments_variant_occurred_at_idx"
  ON "inventory_adjustments"("variant_id", "occurred_at");

CREATE OR REPLACE FUNCTION inventory_reject_adjustment_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory_adjustments is append-only';
END;
$$;

CREATE TRIGGER inventory_adjustments_immutable
BEFORE UPDATE OR DELETE ON "inventory_adjustments"
FOR EACH ROW EXECUTE FUNCTION inventory_reject_adjustment_change();
