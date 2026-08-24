CREATE TABLE "identity_seller_applications" (
  "id" UUID NOT NULL,
  "identity_id" UUID NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "current_revision" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_submitted_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "identity_seller_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_seller_applications_status_check" CHECK (
    "status" IN ('SUBMITTED', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED', 'WITHDRAWN')
  ),
  CONSTRAINT "identity_seller_applications_revision_check" CHECK ("current_revision" > 0)
);

CREATE INDEX "identity_seller_applications_identity_created_idx"
  ON "identity_seller_applications"("identity_id", "created_at" DESC);
CREATE UNIQUE INDEX "identity_seller_applications_one_active_identity_idx"
  ON "identity_seller_applications"("identity_id")
  WHERE "status" IN ('SUBMITTED', 'NEEDS_INFORMATION');

CREATE TABLE "identity_seller_application_revisions" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "applicant_name" VARCHAR(80) NOT NULL,
  "proposed_store_name" VARCHAR(80) NOT NULL,
  "goods_area_text" VARCHAR(120) NOT NULL,
  "current_sales_method" VARCHAR(240) NOT NULL,
  "submitted_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "identity_seller_application_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_seller_application_revisions_application_fkey"
    FOREIGN KEY ("application_id") REFERENCES "identity_seller_applications"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "identity_seller_application_revisions_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "identity_seller_application_revisions_application_revision_key"
    UNIQUE ("application_id", "revision")
);

CREATE TABLE "identity_seller_application_decisions" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "reason_code" VARCHAR(48) NOT NULL,
  "public_reason" VARCHAR(1000) NOT NULL,
  "internal_note" VARCHAR(2000),
  "requested_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "actor_identity_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "identity_seller_application_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_seller_application_decisions_application_fkey"
    FOREIGN KEY ("application_id") REFERENCES "identity_seller_applications"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "identity_seller_application_decisions_action_check" CHECK (
    "action" IN ('REQUEST_INFORMATION', 'APPROVE', 'REJECT', 'WITHDRAW')
  )
);
CREATE INDEX "identity_seller_application_decisions_application_occurred_idx"
  ON "identity_seller_application_decisions"("application_id", "occurred_at");

CREATE TABLE "identity_seller_application_idempotency" (
  "operation" VARCHAR(64) NOT NULL,
  "actor_id" UUID NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  "state" VARCHAR(16) NOT NULL,
  "response" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "identity_seller_application_idempotency_pkey"
    PRIMARY KEY ("operation", "actor_id", "key"),
  CONSTRAINT "identity_seller_application_idempotency_state_check" CHECK (
    "state" IN ('IN_PROGRESS', 'COMPLETED')
  )
);

CREATE TABLE "identity_seller_application_audit" (
  "id" UUID NOT NULL,
  "actor_kind" VARCHAR(24) NOT NULL,
  "actor_identity_id" UUID,
  "audience" VARCHAR(24) NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "target_id" UUID NOT NULL,
  "result" VARCHAR(24) NOT NULL,
  "previous_status" VARCHAR(32),
  "next_status" VARCHAR(32) NOT NULL,
  "previous_revision" INTEGER,
  "next_revision" INTEGER NOT NULL,
  "reason_code" VARCHAR(48),
  "correlation_id" UUID NOT NULL,
  "idempotency_key_hash" VARCHAR(64) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "identity_seller_application_audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "identity_seller_application_audit_target_occurred_idx"
  ON "identity_seller_application_audit"("target_id", "occurred_at");
