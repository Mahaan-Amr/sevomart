import {
  productPublishedV2Contract,
  variantAvailabilityChangedV1Contract,
  variantPriceChangedV1Contract,
} from "@sevo/contracts/product/v1";
import {
  storePublishedV1Contract,
  storeUnpublishedV1Contract,
} from "@sevo/contracts/store/v1";
import postgres from "postgres";
import { beforeEach, describe, expect, it } from "vitest";

import {
  projectDiscoveryProductEvent,
  projectDiscoveryStoreEvent,
} from "../../apps/worker/src/modules/discovery/project-public-feed";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const ids = {
  store: "00000000-0000-4000-8000-000000000001",
  product: "00000000-0000-4000-9000-000000000001",
  variant: "00000000-0000-4000-a000-000000000001",
};

describe("public discovery event projection", () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });

  beforeEach(async () => {
    await sql`delete from discovery_product_feed_version_buffers`;
    await sql`delete from discovery_product_feed_projections`;
    await sql`delete from discovery_store_feed_projections`;
    await sql`
      update discovery_projection_status
      set healthy = true, reason = null, updated_at = '1970-01-01T00:00:00.000Z'
      where projection_name = 'public-feed-v1'
    `;
  });

  it("applies duplicate and out-of-order store versions once", async () => {
    const published = storePublishedV1Contract.parse({
      ...envelope("StorePublished.v1", ids.store, 2, "2026-08-24T10:00:00.000Z"),
      payload: {
        storeId: ids.store,
        publicationStatus: "PUBLISHED",
        publicationVersion: 2,
      },
    });
    const staleUnpublished = storeUnpublishedV1Contract.parse({
      ...envelope("StoreUnpublished.v1", ids.store, 1, "2026-08-24T09:00:00.000Z"),
      payload: {
        storeId: ids.store,
        publicationStatus: "DRAFT",
        publicationVersion: 1,
      },
    });

    for (const event of [published, published, staleUnpublished]) {
      await sql.begin((transaction) => projectDiscoveryStoreEvent(event, transaction));
    }

    const [row] = await sql<
      Array<{ published: boolean; publicationVersion: number; updatedAt: Date }>
    >`
      select published, publication_version as "publicationVersion",
        updated_at as "updatedAt"
      from discovery_store_feed_projections where store_id = ${ids.store}
    `;
    expect(row).toEqual({
      published: true,
      publicationVersion: 2,
      updatedAt: new Date("2026-08-24T10:00:00.000Z"),
    });
  });

  it("buffers early offer and availability versions and preserves first publication", async () => {
    const price = variantPriceChangedV1Contract.parse({
      ...envelope("VariantPriceChanged.v1", ids.product, 5, "2026-08-24T10:05:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        variantId: ids.variant,
        publicationVersion: 2,
        offerVersion: 5,
        price: { amount: 1_500_000, currency: "IRR" },
      },
    });
    const availability = variantAvailabilityChangedV1Contract.parse({
      ...envelope(
        "VariantAvailabilityChanged.v1",
        ids.product,
        7,
        "2026-08-24T10:06:00.000Z",
      ),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        variantId: ids.variant,
        publicationVersion: 2,
        availabilityVersion: 7,
        availability: "AVAILABLE",
      },
    });
    const republished = productPublishedV2Contract.parse({
      ...envelope("ProductPublished.v2", ids.product, 4, "2026-08-24T10:10:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 2,
        snapshot: { variantIds: [ids.variant] },
        offerVersion: 4,
        availabilityVersion: 6,
      },
    });
    const firstPublicationArrivingLate = productPublishedV2Contract.parse({
      ...envelope("ProductPublished.v2", ids.product, 2, "2026-08-17T08:00:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 1,
        snapshot: { variantIds: [ids.variant] },
        offerVersion: 1,
        availabilityVersion: 1,
      },
    });

    for (const event of [price, availability, republished, republished]) {
      await sql.begin((transaction) =>
        projectDiscoveryProductEvent(event, transaction),
      );
    }
    await sql.begin((transaction) =>
      projectDiscoveryProductEvent(firstPublicationArrivingLate, transaction),
    );

    const [row] = await sql<
      Array<{
        publicationVersion: number;
        productAggregateVersion: number;
        offerVersion: number;
        availabilityVersion: number;
        firstPublishedAt: Date;
        eligibleSince: Date;
      }>
    >`
      select publication_version as "publicationVersion",
        product_aggregate_version as "productAggregateVersion",
        offer_version as "offerVersion",
        availability_version as "availabilityVersion",
        first_published_at as "firstPublishedAt", eligible_since as "eligibleSince"
      from discovery_product_feed_projections where product_id = ${ids.product}
    `;
    expect(row).toEqual({
      publicationVersion: 2,
      productAggregateVersion: 4,
      offerVersion: 5,
      availabilityVersion: 7,
      firstPublishedAt: new Date("2026-08-17T08:00:00.000Z"),
      eligibleSince: new Date("2026-08-24T10:10:00.000Z"),
    });
    expect(
      await sql`select * from discovery_product_feed_version_buffers`,
    ).toHaveLength(0);
  });
});

function envelope(
  eventType: string,
  aggregateId: string,
  aggregateVersion: number,
  occurredAt: string,
) {
  return {
    version: 1 as const,
    eventId: crypto.randomUUID(),
    eventType,
    aggregateId,
    aggregateVersion,
    occurredAt,
    correlationId: crypto.randomUUID(),
    causationId: crypto.randomUUID(),
    actor: { type: "SYSTEM" as const },
  };
}
