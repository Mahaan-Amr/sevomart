ALTER TABLE "product_products"
  DROP CONSTRAINT "product_products_state_check",
  ADD CONSTRAINT "product_products_state_check"
    CHECK ("state" IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED'));

CREATE TABLE "product_state_transitions" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "actor_identity_id" UUID NOT NULL,
  "previous_state" VARCHAR(24) NOT NULL,
  "next_state" VARCHAR(24) NOT NULL,
  "previous_revision" INTEGER NOT NULL,
  "next_revision" INTEGER NOT NULL,
  "reason_code" VARCHAR(32) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_state_transitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_state_transitions_product_id_fkey" FOREIGN KEY ("product_id")
    REFERENCES "product_products"("id") ON DELETE RESTRICT,
  CONSTRAINT "product_state_transitions_revision_check"
    CHECK ("previous_revision" >= 0 AND "next_revision" = "previous_revision" + 1),
  CONSTRAINT "product_state_transitions_reason_code_check"
    CHECK ("reason_code" IN ('SELLER_REQUEST', 'TEMPORARILY_UNAVAILABLE',
      'NEEDS_CORRECTION'))
);

CREATE INDEX "product_state_transitions_product_occurred_at_idx"
  ON "product_state_transitions"("product_id", "occurred_at");

CREATE OR REPLACE FUNCTION product_reject_state_transition_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'product_state_transitions is append-only';
END;
$$;

CREATE TRIGGER product_state_transitions_immutable
BEFORE UPDATE OR DELETE ON "product_state_transitions"
FOR EACH ROW EXECUTE FUNCTION product_reject_state_transition_change();
