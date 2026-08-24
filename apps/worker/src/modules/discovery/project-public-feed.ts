import {
  productPublishedV1Contract,
  productPublishedV2Contract,
  productUnpublishedV1Contract,
  variantAvailabilityChangedV1Contract,
  variantPriceChangedV1Contract,
} from "@sevo/contracts/product/v1";
import { discoveryFeedProjectionEventTypes } from "@sevo/contracts/discovery/v1";
import {
  storePublishedV1Contract,
  storeUnpublishedV1Contract,
} from "@sevo/contracts/store/v1";
import type { OutboxEventHandler } from "@sevo/outbox";
import postgres from "postgres";

type ProductProjectionRow = {
  publicationVersion: number;
  productAggregateVersion: number;
  published: boolean;
  firstPublishedAt: Date;
  eligibleSince: Date;
  offerVersion: number;
  availabilityVersion: number;
};

export const projectDiscoveryStoreEvent: OutboxEventHandler = async (event, sql) => {
  const changed =
    event.eventType === "StorePublished.v1"
      ? storePublishedV1Contract.parse(event)
      : storeUnpublishedV1Contract.parse(event);
  const publicationVersion =
    changed.payload.publicationVersion ?? changed.aggregateVersion;
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`discovery-store-feed:${changed.payload.storeId}`}, 0)
    )
  `;
  const current = await sql<Array<{ aggregateVersion: number }>>`
    select aggregate_version as "aggregateVersion"
    from discovery_store_feed_projections
    where store_id = ${changed.payload.storeId}
    for update
  `;
  if ((current[0]?.aggregateVersion ?? 0) >= changed.aggregateVersion) {
    await reconcileProjectionHealth(sql, changed.occurredAt);
    return;
  }

  await sql`
    insert into discovery_store_feed_projections
      (store_id, published, aggregate_version, publication_version, updated_at)
    values
      (${changed.payload.storeId},
       ${changed.eventType === "StorePublished.v1"},
       ${changed.aggregateVersion}, ${publicationVersion}, ${changed.occurredAt})
    on conflict (store_id) do update set
      published = excluded.published,
      aggregate_version = excluded.aggregate_version,
      publication_version = excluded.publication_version,
      updated_at = excluded.updated_at
  `;
  await reconcileProjectionHealth(sql, changed.occurredAt);
};

export const projectDiscoveryProductEvent: OutboxEventHandler = async (event, sql) => {
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`discovery-product-feed:${event.aggregateId}`}, 0)
    )
  `;
  if (
    event.eventType === "ProductPublished.v1" ||
    event.eventType === "ProductPublished.v2"
  ) {
    const published =
      event.eventType === "ProductPublished.v1"
        ? productPublishedV1Contract.parse(event)
        : productPublishedV2Contract.parse(event);
    await projectPublication(published, sql);
  } else if (event.eventType === "ProductUnpublished.v1") {
    const unpublished = productUnpublishedV1Contract.parse(event);
    await projectUnpublication(unpublished, sql);
  } else if (event.eventType === "VariantPriceChanged.v1") {
    const price = variantPriceChangedV1Contract.parse(event);
    await projectVersion(
      price.payload.productId,
      price.payload.publicationVersion,
      "OFFER",
      price.payload.offerVersion,
      price.occurredAt,
      sql,
    );
  } else {
    const availability = variantAvailabilityChangedV1Contract.parse(event);
    await projectVersion(
      availability.payload.productId,
      availability.payload.publicationVersion,
      "AVAILABILITY",
      availability.payload.availabilityVersion,
      availability.occurredAt,
      sql,
    );
  }
  await reconcileProjectionHealth(sql, event.occurredAt);
};

async function projectPublication(
  published: ReturnType<
    typeof productPublishedV1Contract.parse | typeof productPublishedV2Contract.parse
  >,
  sql: Parameters<OutboxEventHandler>[1],
) {
  const rows = await sql<ProductProjectionRow[]>`
    select publication_version as "publicationVersion",
      product_aggregate_version as "productAggregateVersion", published,
      first_published_at as "firstPublishedAt", eligible_since as "eligibleSince",
      offer_version as "offerVersion",
      availability_version as "availabilityVersion"
    from discovery_product_feed_projections
    where product_id = ${published.payload.productId}
    for update
  `;
  const current = rows[0];
  const occurredAt = new Date(published.occurredAt);
  if (!current) {
    await sql`
      insert into discovery_product_feed_projections
        (product_id, store_id, product_aggregate_version, publication_version,
         published, first_published_at, eligible_since, offer_version,
         availability_version, updated_at)
      values
        (${published.payload.productId}, ${published.payload.storeId},
         ${published.aggregateVersion}, ${published.payload.publicationVersion},
         true, ${occurredAt}, ${occurredAt}, ${published.payload.offerVersion},
         ${published.payload.availabilityVersion}, ${occurredAt})
    `;
  } else if (published.aggregateVersion > current.productAggregateVersion) {
    await sql`
      update discovery_product_feed_projections set
        store_id = ${published.payload.storeId},
        product_aggregate_version = ${published.aggregateVersion},
        publication_version = ${published.payload.publicationVersion},
        published = true,
        eligible_since = case when published then eligible_since else ${occurredAt} end,
        offer_version = greatest(offer_version, ${published.payload.offerVersion}),
        availability_version = greatest(
          availability_version, ${published.payload.availabilityVersion}
        ),
        updated_at = ${occurredAt}
      where product_id = ${published.payload.productId}
    `;
  } else return;

  await applyBufferedVersions(
    published.payload.productId,
    published.payload.publicationVersion,
    sql,
  );
}

async function projectUnpublication(
  unpublished: ReturnType<typeof productUnpublishedV1Contract.parse>,
  sql: Parameters<OutboxEventHandler>[1],
) {
  const rows = await sql<Array<{ aggregateVersion: number }>>`
    select product_aggregate_version as "aggregateVersion"
    from discovery_product_feed_projections
    where product_id = ${unpublished.payload.productId}
    for update
  `;
  const current = rows[0];
  if (current && current.aggregateVersion >= unpublished.aggregateVersion) return;
  if (current) {
    await sql`
    update discovery_product_feed_projections set
      product_aggregate_version = ${unpublished.aggregateVersion},
      publication_version = ${unpublished.payload.publicationVersion},
      published = false,
      updated_at = ${unpublished.occurredAt}
    where product_id = ${unpublished.payload.productId}
    `;
    return;
  }

  await sql`
    insert into discovery_product_feed_version_buffers
      (product_id, publication_version, version_kind, version, updated_at)
    values (${unpublished.payload.productId}, ${unpublished.payload.publicationVersion},
      'PUBLICATION', ${unpublished.aggregateVersion}, ${unpublished.occurredAt})
    on conflict (product_id, publication_version, version_kind) do update set
      version = greatest(discovery_product_feed_version_buffers.version,
        excluded.version),
      updated_at = excluded.updated_at
  `;
}

async function projectVersion(
  productId: string,
  publicationVersion: number,
  kind: "OFFER" | "AVAILABILITY",
  version: number,
  occurredAt: string,
  sql: Parameters<OutboxEventHandler>[1],
) {
  const rows = await sql<Array<{ publicationVersion: number }>>`
    select publication_version as "publicationVersion"
    from discovery_product_feed_projections
    where product_id = ${productId}
    for update
  `;
  const current = rows[0];
  if (!current || publicationVersion > current.publicationVersion) {
    await sql`
      insert into discovery_product_feed_version_buffers
        (product_id, publication_version, version_kind, version, updated_at)
      values (${productId}, ${publicationVersion}, ${kind}, ${version}, ${occurredAt})
      on conflict (product_id, publication_version, version_kind) do update set
        version = greatest(discovery_product_feed_version_buffers.version,
          excluded.version),
        updated_at = case
          when excluded.version > discovery_product_feed_version_buffers.version
          then excluded.updated_at
          else discovery_product_feed_version_buffers.updated_at
        end
    `;
    return;
  }
  if (publicationVersion < current.publicationVersion) return;
  const column = kind === "OFFER" ? "offer_version" : "availability_version";
  await sql.unsafe(
    `update discovery_product_feed_projections
     set ${column} = $1, updated_at = $2
     where product_id = $3 and ${column} < $1
     returning product_id`,
    [version, occurredAt, productId],
  );
}

async function applyBufferedVersions(
  productId: string,
  publicationVersion: number,
  sql: Parameters<OutboxEventHandler>[1],
) {
  const buffers = await sql<
    Array<{
      kind: "OFFER" | "AVAILABILITY" | "PUBLICATION";
      version: number;
      publicationVersion: number;
      updatedAt: Date;
    }>
  >`
    select version_kind as kind, version,
      publication_version as "publicationVersion", updated_at as "updatedAt"
    from discovery_product_feed_version_buffers
    where product_id = ${productId} and publication_version = ${publicationVersion}
  `;
  for (const buffer of buffers) {
    if (buffer.kind === "PUBLICATION") {
      await sql`
        update discovery_product_feed_projections set
          product_aggregate_version = greatest(product_aggregate_version,
            ${buffer.version}),
          publication_version = greatest(publication_version,
            ${buffer.publicationVersion}),
          published = false,
          updated_at = greatest(updated_at, ${buffer.updatedAt})
        where product_id = ${productId}
          and product_aggregate_version < ${buffer.version}
      `;
      continue;
    }
    const column = buffer.kind === "OFFER" ? "offer_version" : "availability_version";
    await sql.unsafe(
      `update discovery_product_feed_projections
       set ${column} = greatest(${column}, $1)
       where product_id = $2`,
      [buffer.version, productId],
    );
  }
  await sql`
    delete from discovery_product_feed_version_buffers
    where product_id = ${productId} and publication_version <= ${publicationVersion}
  `;
}

export async function reconcileDiscoveryProjectionHealth(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const status = await sql.begin((transaction) =>
      reconcileProjectionHealth(transaction, new Date().toISOString()),
    );
    console.log(
      JSON.stringify({
        level: status.healthy ? "info" : "warn",
        message: "discovery_projection_health_reconciled",
        healthy: status.healthy,
        reason: status.reason,
      }),
    );
  } finally {
    await sql.end();
  }
}

async function reconcileProjectionHealth(
  sql: Parameters<OutboxEventHandler>[1],
  occurredAt: string,
) {
  const rows = await sql<Array<{ pendingEvents: number; unresolvedBuffers: number }>>`
    select
      (select count(*)::int
       from platform_outbox_events event
       left join platform_outbox_consumptions consumption
         on consumption.event_id = event.event_id
        and consumption.consumer_name = 'discovery-public-feed-v1'
       where event.event_type in ${sql(discoveryFeedProjectionEventTypes)}
         and consumption.event_id is null) as "pendingEvents",
      (select count(*)::int
       from discovery_product_feed_version_buffers) as "unresolvedBuffers"
  `;
  const counts = rows[0] ?? { pendingEvents: 1, unresolvedBuffers: 1 };
  const reason =
    counts.unresolvedBuffers > 0
      ? "UNRESOLVED_BUFFERS"
      : counts.pendingEvents > 0
        ? "PENDING_EVENTS"
        : null;
  await sql`
    update discovery_projection_status
    set healthy = ${reason === null}, reason = ${reason},
      updated_at = greatest(updated_at, ${occurredAt})
    where projection_name = 'public-feed-v1'
  `;
  return { healthy: reason === null, reason };
}
