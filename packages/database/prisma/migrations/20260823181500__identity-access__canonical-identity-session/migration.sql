ALTER TABLE "identity_otp_challenges"
ADD COLUMN "verification_attempts" SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE "identity_otp_challenges"
ADD CONSTRAINT "identity_otp_challenges_verification_attempts_check"
CHECK ("verification_attempts" BETWEEN 0 AND 5);

ALTER TABLE "identity_sellers" RENAME TO "identity_identities";
ALTER TABLE "identity_identities" RENAME CONSTRAINT "identity_sellers_pkey" TO "identity_identities_pkey";
ALTER INDEX "identity_sellers_mobile_key" RENAME TO "identity_identities_mobile_key";

ALTER TABLE "identity_identities"
ADD COLUMN "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE "identity_login_methods" (
    "id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'MOBILE',
    "mobile" VARCHAR(11) NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "identity_login_methods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "identity_login_methods_identity_id_fkey"
      FOREIGN KEY ("identity_id") REFERENCES "identity_identities"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "identity_login_methods"
  ("id", "identity_id", "kind", "mobile", "verified_at", "created_at")
SELECT "id", "id", 'MOBILE', "mobile", "created_at", "created_at"
FROM "identity_identities";

CREATE UNIQUE INDEX "identity_login_methods_mobile_key"
ON "identity_login_methods"("mobile");
CREATE UNIQUE INDEX "identity_login_methods_identity_kind_key"
ON "identity_login_methods"("identity_id", "kind");

ALTER TABLE "identity_seller_sessions" RENAME TO "identity_sessions";
ALTER TABLE "identity_sessions" RENAME CONSTRAINT "identity_seller_sessions_pkey" TO "identity_sessions_pkey";
ALTER TABLE "identity_sessions" RENAME CONSTRAINT "identity_seller_sessions_seller_id_fkey" TO "identity_sessions_identity_id_fkey";
ALTER TABLE "identity_sessions" RENAME COLUMN "seller_id" TO "identity_id";
ALTER INDEX "identity_seller_sessions_token_hash_key" RENAME TO "identity_sessions_token_hash_key";
ALTER INDEX "identity_seller_sessions_seller_id_expires_at_idx" RENAME TO "identity_sessions_identity_id_expires_at_idx";

ALTER TABLE "identity_sessions"
ADD COLUMN "audience" VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN "revoked_at" TIMESTAMPTZ(3);

UPDATE "identity_sessions" SET "revoked_at" = CURRENT_TIMESTAMP;

ALTER TABLE "identity_identities" DROP COLUMN "mobile";
