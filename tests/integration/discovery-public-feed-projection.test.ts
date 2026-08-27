import { variantAvailabilityChangedV1Contract } from "@sevo/contracts/inventory/v1";
import { discoveryFeedProjectionEventTypes } from "@sevo/contracts/discovery/v1";
import {
  productPublishedV2Contract,
  productPublishedV1Contract,
  productUnpublishedV1Contract,
  variantPriceChangedV1Contract,
} from "@sevo/contracts/product/v1";
import {
  storePublishedV1Contract,
  storeUnpublishedV1Contract,
} from "@sevo/contracts/store/v1";
import postgres from "postgres";
import { beforeEach, describe, expect, it } from "vitest";

import {
  catchUpDiscoveryPublicFeedProjection,
  projectDiscoveryProductEvent,
  projectDiscoveryStoreEvent,
  rebuildDiscoveryPublicFeedProjection,
} from "../../apps/worker/src/modules/discovery/project-public-feed";
import { enqueueOutboxEvent } from "@sevo/outbox";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const ids = {
  store: "00000000-0000-4000-8000-000000000001",
  product: "00000000-0000-4000-9000-000000000001",
  variant: "00000000-0000-4000-a000-000000000001",
};

describe("public discovery event projection", () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });

  beforeEach(async () => {
    await sql`
      delete from platform_outbox_consumptions
      where event_id in (
        select event_id from platform_outbox_events
        where event_type in ${sql(discoveryFeedProjectionEventTypes)}
      )
    `;
    await sql`
      delete from platform_outbox_events
      where event_type in ${sql(discoveryFeedProjectionEventTypes)}
    `;
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

  it("rebuilds mixed legacy and canonical publication history without reviving an old generation", async () => {
    const mediaId = crypto.randomUUID();
    const legacy = productPublishedV1Contract.parse({
      ...envelope("ProductPublished.v1", ids.product, 2, "2026-08-17T08:00:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 1,
        offerVersion: 1,
        availabilityVersion: 1,
        snapshot: {
          productId: ids.product,
          name: "نام قدیمی کالا",
          image: { id: mediaId, url: `/v1/media/${mediaId}` },
          price: { amount: 1_000_000, currency: "IRR" },
          availability: "AVAILABLE",
          publicationVersion: 1,
        },
      },
    });
    const canonical = productPublishedV2Contract.parse({
      ...envelope("ProductPublished.v2", ids.product, 4, "2026-08-24T10:00:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 2,
        offerVersion: 2,
        availabilityVersion: 3,
        snapshot: { variantIds: [ids.variant] },
      },
    });
    const unpublished = productUnpublishedV1Contract.parse({
      ...envelope("ProductUnpublished.v1", ids.product, 5, "2026-08-24T11:00:00.000Z"),
      payload: { storeId: ids.store, productId: ids.product, publicationVersion: 2 },
    });
    for (const event of [canonical, unpublished, legacy, legacy]) {
      await sql.begin((transaction) =>
        projectDiscoveryProductEvent(event, transaction),
      );
    }
    const readProjection = () => sql`
      select published, publication_version, first_published_at, offer_version, availability_version
      from discovery_product_feed_projections where product_id = ${ids.product}
    `;
    const projected = await readProjection();
    expect(projected).toEqual([
      {
        published: false,
        publication_version: 2,
        first_published_at: new Date("2026-08-17T08:00:00.000Z"),
        offer_version: 2,
        availability_version: 3,
      },
    ]);
    for (const event of [legacy, canonical, unpublished])
      await enqueueOutboxEvent(sql, event);
    await rebuildDiscoveryPublicFeedProjection(apiTestEnvironment.DATABASE_URL);
    expect(await readProjection()).toEqual(projected);
  });

  it("does not restore a store from a stale publication generation", async () => {
    const unpublished = storeUnpublishedV1Contract.parse({
      ...envelope("StoreUnpublished.v1", ids.store, 2, "2026-08-24T10:00:00.000Z"),
      payload: {
        storeId: ids.store,
        publicationStatus: "DRAFT",
        publicationVersion: 2,
      },
    });
    const stalePublished = storePublishedV1Contract.parse({
      ...envelope("StorePublished.v1", ids.store, 3, "2026-08-24T10:05:00.000Z"),
      payload: {
        storeId: ids.store,
        publicationStatus: "PUBLISHED",
        publicationVersion: 1,
      },
    });

    for (const event of [unpublished, stalePublished]) {
      await sql.begin((transaction) => projectDiscoveryStoreEvent(event, transaction));
    }

    const [row] = await sql<
      Array<{
        published: boolean;
        publicationVersion: number;
        aggregateVersion: number;
      }>
    >`
      select published, publication_version as "publicationVersion",
        aggregate_version as "aggregateVersion"
      from discovery_store_feed_projections where store_id = ${ids.store}
    `;
    expect(row).toEqual({
      published: false,
      publicationVersion: 2,
      aggregateVersion: 2,
    });
  });

  it("buffers early versions and keeps the ranking timestamp immutable", async () => {
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

  it("buffers an early unpublish and applies its tombstone after publication", async () => {
    const unpublished = productUnpublishedV1Contract.parse({
      ...envelope("ProductUnpublished.v1", ids.product, 3, "2026-08-24T10:20:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 1,
      },
    });
    const published = productPublishedV2Contract.parse({
      ...envelope("ProductPublished.v2", ids.product, 2, "2026-08-24T10:00:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 1,
        snapshot: { variantIds: [ids.variant] },
        offerVersion: 1,
        availabilityVersion: 1,
      },
    });

    await sql.begin((transaction) =>
      projectDiscoveryProductEvent(unpublished, transaction),
    );
    const [bufferedHealth] = await sql<Array<{ healthy: boolean; reason: string }>>`
      select healthy, reason from discovery_projection_status
      where projection_name = 'public-feed-v1'
    `;
    expect(bufferedHealth).toEqual({ healthy: false, reason: "UNRESOLVED_BUFFERS" });

    await sql.begin((transaction) =>
      projectDiscoveryProductEvent(published, transaction),
    );
    const [row] = await sql<
      Array<{ published: boolean; productAggregateVersion: number }>
    >`
      select published, product_aggregate_version as "productAggregateVersion"
      from discovery_product_feed_projections where product_id = ${ids.product}
    `;
    expect(row).toEqual({ published: false, productAggregateVersion: 3 });
    expect(
      await sql`select * from discovery_product_feed_version_buffers`,
    ).toHaveLength(0);
  });

  it("keeps publication state monotonic when aggregate and publication versions diverge", async () => {
    const current = productPublishedV2Contract.parse({
      ...envelope("ProductPublished.v2", ids.product, 4, "2026-08-24T10:00:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 2,
        snapshot: { variantIds: [ids.variant] },
        offerVersion: 4,
        availabilityVersion: 6,
      },
    });
    const stalePublicationWithNewerAggregate = productUnpublishedV1Contract.parse({
      ...envelope("ProductUnpublished.v1", ids.product, 10, "2026-08-24T10:05:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 1,
      },
    });
    const newerPublicationWithOlderAggregate = productPublishedV2Contract.parse({
      ...envelope("ProductPublished.v2", ids.product, 5, "2026-08-24T10:10:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 3,
        snapshot: { variantIds: [ids.variant] },
        offerVersion: 5,
        availabilityVersion: 7,
      },
    });
    const currentGenerationUnpublished = productUnpublishedV1Contract.parse({
      ...envelope("ProductUnpublished.v1", ids.product, 6, "2026-08-24T10:15:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 3,
      },
    });

    for (const event of [
      current,
      stalePublicationWithNewerAggregate,
      newerPublicationWithOlderAggregate,
      currentGenerationUnpublished,
    ]) {
      await sql.begin((transaction) =>
        projectDiscoveryProductEvent(event, transaction),
      );
    }

    const [row] = await sql<
      Array<{
        publicationVersion: number;
        productAggregateVersion: number;
        published: boolean;
        offerVersion: number;
        availabilityVersion: number;
      }>
    >`
      select publication_version as "publicationVersion",
        product_aggregate_version as "productAggregateVersion", published,
        offer_version as "offerVersion",
        availability_version as "availabilityVersion"
      from discovery_product_feed_projections where product_id = ${ids.product}
    `;
    expect(row).toEqual({
      publicationVersion: 3,
      productAggregateVersion: 6,
      published: false,
      offerVersion: 5,
      availabilityVersion: 7,
    });
  });

  it("rebuilds an equivalent projection when the event archive contains duplicates", async () => {
    const published = productPublishedV2Contract.parse({
      ...envelope("ProductPublished.v2", ids.product, 2, "2026-08-24T10:00:00.000Z"),
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 1,
        snapshot: { variantIds: [ids.variant] },
        offerVersion: 1,
        availabilityVersion: 1,
      },
    });
    const replay = [published, published];
    for (const event of replay) {
      await sql.begin((transaction) =>
        projectDiscoveryProductEvent(event, transaction),
      );
    }
    const readProjection = () => sql`
      select product_id, store_id, product_aggregate_version,
        publication_version, published, first_published_at, eligible_since,
        offer_version, availability_version, updated_at
      from discovery_product_feed_projections where product_id = ${ids.product}
    `;
    const firstBuild = await readProjection();

    await sql`delete from discovery_product_feed_version_buffers
      where product_id = ${ids.product}`;
    await sql`delete from discovery_product_feed_projections
      where product_id = ${ids.product}`;
    for (const event of replay) {
      await sql.begin((transaction) =>
        projectDiscoveryProductEvent(event, transaction),
      );
    }

    expect(await readProjection()).toEqual(firstBuild);
  });

  it("rebuilds the live store and product projection atomically from the event archive", async () => {
    const archived = [
      storePublishedV1Contract.parse({
        ...envelope("StorePublished.v1", ids.store, 1, "2026-08-17T07:00:00.000Z"),
        payload: {
          storeId: ids.store,
          publicationStatus: "PUBLISHED",
          publicationVersion: 1,
        },
      }),
      productPublishedV2Contract.parse({
        ...envelope("ProductPublished.v2", ids.product, 2, "2026-08-17T08:00:00.000Z"),
        payload: {
          storeId: ids.store,
          productId: ids.product,
          publicationVersion: 1,
          snapshot: { variantIds: [ids.variant] },
          offerVersion: 1,
          availabilityVersion: 1,
        },
      }),
      productUnpublishedV1Contract.parse({
        ...envelope(
          "ProductUnpublished.v1",
          ids.product,
          3,
          "2026-08-20T08:00:00.000Z",
        ),
        payload: {
          storeId: ids.store,
          productId: ids.product,
          publicationVersion: 1,
        },
      }),
      productPublishedV2Contract.parse({
        ...envelope("ProductPublished.v2", ids.product, 4, "2026-08-24T10:00:00.000Z"),
        payload: {
          storeId: ids.store,
          productId: ids.product,
          publicationVersion: 2,
          snapshot: { variantIds: [ids.variant] },
          offerVersion: 4,
          availabilityVersion: 6,
        },
      }),
    ];
    for (const event of archived) {
      await sql.begin((transaction) => enqueueOutboxEvent(transaction, event));
    }
    await sql`
      insert into platform_outbox_consumptions (consumer_name, event_id, consumed_at)
      select 'discovery-public-feed-v1', event_id, now()
      from platform_outbox_events
      where event_id in ${sql(archived.map((event) => event.eventId))}
    `;

    for (const event of archived) {
      await sql.begin((transaction) =>
        event.eventType.startsWith("Store")
          ? projectDiscoveryStoreEvent(event, transaction)
          : projectDiscoveryProductEvent(event, transaction),
      );
    }
    const expectedStore = await sql`
      select store_id, published, aggregate_version, publication_version, updated_at
      from discovery_store_feed_projections where store_id = ${ids.store}
    `;
    const expectedProduct = await sql`
      select product_id, store_id, product_aggregate_version,
        publication_version, published, first_published_at, eligible_since,
        publication_updated_at, offer_version, availability_version, updated_at
      from discovery_product_feed_projections where product_id = ${ids.product}
    `;
    const expectedBuffers = await sql`
      select product_id, publication_version, version_kind, version, updated_at
      from discovery_product_feed_version_buffers where product_id = ${ids.product}
      order by publication_version, version_kind
    `;
    await sql`delete from discovery_product_feed_version_buffers`;
    await sql`delete from discovery_product_feed_projections`;
    await sql`delete from discovery_store_feed_projections`;

    const result = await rebuildDiscoveryPublicFeedProjection(
      apiTestEnvironment.DATABASE_URL,
      () => undefined,
    );

    expect(result.replayedEventCount).toBeGreaterThanOrEqual(archived.length);
    expect(
      await sql`
        select store_id, published, aggregate_version, publication_version, updated_at
        from discovery_store_feed_projections where store_id = ${ids.store}
      `,
    ).toEqual(expectedStore);
    expect(
      await sql`
        select product_id, store_id, product_aggregate_version,
          publication_version, published, first_published_at, eligible_since,
          publication_updated_at, offer_version, availability_version, updated_at
        from discovery_product_feed_projections where product_id = ${ids.product}
      `,
    ).toEqual(expectedProduct);
    expect(
      await sql`
        select product_id, publication_version, version_kind, version, updated_at
        from discovery_product_feed_version_buffers where product_id = ${ids.product}
        order by publication_version, version_kind
      `,
    ).toEqual(expectedBuffers);
    const [store] = await sql<
      Array<{ published: boolean; publicationVersion: number }>
    >`
      select published, publication_version as "publicationVersion"
      from discovery_store_feed_projections where store_id = ${ids.store}
    `;
    expect(store).toEqual({ published: true, publicationVersion: 1 });
    const [product] = await sql<
      Array<{
        published: boolean;
        publicationVersion: number;
        firstPublishedAt: Date;
        eligibleSince: Date;
      }>
    >`
      select published, publication_version as "publicationVersion",
        first_published_at as "firstPublishedAt", eligible_since as "eligibleSince"
      from discovery_product_feed_projections where product_id = ${ids.product}
    `;
    expect(product).toEqual({
      published: true,
      publicationVersion: 2,
      firstPublishedAt: new Date("2026-08-17T08:00:00.000Z"),
      eligibleSince: new Date("2026-08-24T10:00:00.000Z"),
    });
  });

  it("catches up an event that another outbox consumer processed first", async () => {
    const published = storePublishedV1Contract.parse({
      ...envelope("StorePublished.v1", ids.store, 1, new Date().toISOString()),
      payload: {
        storeId: ids.store,
        publicationStatus: "PUBLISHED",
        publicationVersion: 1,
      },
    });
    await sql.begin((transaction) => enqueueOutboxEvent(transaction, published));
    await sql`
      update platform_outbox_events set status = 'PROCESSED', processed_at = now()
      where event_id = ${published.eventId}
    `;
    await sql`
      insert into platform_outbox_consumptions (consumer_name, event_id, consumed_at)
      values ('reporting-store-publications-v1', ${published.eventId}, now())
    `;

    const result = await catchUpDiscoveryPublicFeedProjection(
      apiTestEnvironment.DATABASE_URL,
      () => undefined,
    );

    expect(result).toEqual({ replayedEventCount: 1, poisonEventCount: 0 });
    const [projection] = await sql<Array<{ published: boolean }>>`
      select published from discovery_store_feed_projections
      where store_id = ${ids.store}
    `;
    expect(projection).toEqual({ published: true });
    const receipts = await sql<Array<{ count: number }>>`
      select count(*)::int as count from platform_outbox_consumptions
      where consumer_name = 'discovery-public-feed-v1'
        and event_id = ${published.eventId}
    `;
    expect(receipts).toEqual([{ count: 1 }]);
  });

  it("converges on one projection for every ordering of publication and saleability events", async () => {
    const events = [
      productPublishedV2Contract.parse({
        ...envelope("ProductPublished.v2", ids.product, 2, "2026-08-17T08:00:00.000Z"),
        payload: {
          storeId: ids.store,
          productId: ids.product,
          publicationVersion: 1,
          snapshot: { variantIds: [ids.variant] },
          offerVersion: 1,
          availabilityVersion: 1,
        },
      }),
      productUnpublishedV1Contract.parse({
        ...envelope(
          "ProductUnpublished.v1",
          ids.product,
          3,
          "2026-08-20T08:00:00.000Z",
        ),
        payload: {
          storeId: ids.store,
          productId: ids.product,
          publicationVersion: 1,
        },
      }),
      productPublishedV2Contract.parse({
        ...envelope("ProductPublished.v2", ids.product, 4, "2026-08-24T10:00:00.000Z"),
        payload: {
          storeId: ids.store,
          productId: ids.product,
          publicationVersion: 2,
          snapshot: { variantIds: [ids.variant] },
          offerVersion: 4,
          availabilityVersion: 6,
        },
      }),
      variantPriceChangedV1Contract.parse({
        ...envelope(
          "VariantPriceChanged.v1",
          ids.variant,
          5,
          "2026-08-24T10:05:00.000Z",
        ),
        payload: {
          storeId: ids.store,
          productId: ids.product,
          variantId: ids.variant,
          publicationVersion: 2,
          offerVersion: 5,
          price: { amount: 1_500_000, currency: "IRR" },
        },
      }),
      variantAvailabilityChangedV1Contract.parse({
        ...envelope(
          "VariantAvailabilityChanged.v1",
          ids.variant,
          6,
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
      }),
    ];

    for (const ordering of permutations(events)) {
      await sql`delete from discovery_product_feed_version_buffers`;
      await sql`delete from discovery_product_feed_projections`;
      for (const event of ordering) {
        await sql.begin((transaction) =>
          projectDiscoveryProductEvent(event, transaction),
        );
      }
      const [row] = await sql<
        Array<{
          publicationVersion: number;
          productAggregateVersion: number;
          published: boolean;
          firstPublishedAt: Date;
          eligibleSince: Date;
          offerVersion: number;
          availabilityVersion: number;
        }>
      >`
        select publication_version as "publicationVersion",
          product_aggregate_version as "productAggregateVersion", published,
          first_published_at as "firstPublishedAt", eligible_since as "eligibleSince",
          offer_version as "offerVersion",
          availability_version as "availabilityVersion"
        from discovery_product_feed_projections where product_id = ${ids.product}
      `;
      expect(row).toEqual({
        publicationVersion: 2,
        productAggregateVersion: 4,
        published: true,
        firstPublishedAt: new Date("2026-08-17T08:00:00.000Z"),
        eligibleSince: new Date("2026-08-24T10:00:00.000Z"),
        offerVersion: 5,
        availabilityVersion: 7,
      });
    }
  }, 30_000);
});

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [Array.from(values)];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidateIndex) => candidateIndex !== index)).map(
      (rest) => [value, ...rest],
    ),
  );
}

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
