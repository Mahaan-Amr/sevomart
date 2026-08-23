CREATE TABLE "reporting_store_publications" (
  "store_id" UUID NOT NULL,
  "last_event_id" UUID NOT NULL,
  "publication_version" INTEGER NOT NULL,
  "published_at" TIMESTAMPTZ(3) NOT NULL,
  "projected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reporting_store_publications_pkey" PRIMARY KEY ("store_id")
);

CREATE UNIQUE INDEX "reporting_store_publications_last_event_id_key"
  ON "reporting_store_publications"("last_event_id");
