CREATE TABLE "identity_sellers" (
    "id" UUID NOT NULL,
    "mobile" VARCHAR(11) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "identity_sellers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "identity_otp_challenges" (
    "id" UUID NOT NULL,
    "mobile" VARCHAR(11) NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "provider_reference" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "identity_otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "identity_seller_sessions" (
    "id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "seller_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "identity_seller_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "identity_sellers_mobile_key" ON "identity_sellers"("mobile");
CREATE INDEX "identity_otp_challenges_mobile_created_at_idx" ON "identity_otp_challenges"("mobile", "created_at");
CREATE UNIQUE INDEX "identity_seller_sessions_token_hash_key" ON "identity_seller_sessions"("token_hash");
CREATE INDEX "identity_seller_sessions_seller_id_expires_at_idx" ON "identity_seller_sessions"("seller_id", "expires_at");

ALTER TABLE "identity_seller_sessions"
ADD CONSTRAINT "identity_seller_sessions_seller_id_fkey"
FOREIGN KEY ("seller_id") REFERENCES "identity_sellers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
