import { variantAvailabilityChangedV1Contract } from "@sevo/contracts/inventory/v1";
import {
  productPublishedV2Contract,
  productUnpublishedV1Contract,
  variantPriceChangedV1Contract,
} from "@sevo/contracts/product/v1";
import {
  discoveryFeedProjectionEventTypes,
  discoveryProjectionOperationsV1,
} from "@sevo/contracts/discovery/v1";
import {
  storePublishedV1Contract,
  storeUnpublishedV1Contract,
} from "@sevo/contracts/store/v1";
import {
  catchUpOutboxConsumer,
  readOutboxConsumerBacklog,
  replayOutboxEventHistory,
  type OutboxEventHandler,
  type StoredOutboxEvent,
} from "@sevo/outbox";
import { getMeter } from "@sevo/observability";
import postgres from "postgres";
import {
  readLegacyProductPublication,
  type ProductPublicationMetadata,
} from "./legacy-product-publication";

type ProductProjectionRow = {
  publicationVersion: number;
  productAggregateVersion: number;
  published: boolean;
  firstPublishedAt: Date;
  eligibleSince: Date;
  publicationUpdatedAt: Date;
  offerVersion: number;
  availabilityVersion: number;
};

type ProjectionLog = (record: Readonly<Record<string, unknown>>) => void;

const projectionMeter = getMeter("sevo.discovery.public-feed");
const projectionHealthyMetric = projectionMeter.createGauge(
  "sevo.discovery.projection.healthy",
);
const projectionLagMetric = projectionMeter.createGauge(
  "sevo.discovery.projection.lag",
  { unit: "ms" },
);
const projectionPendingMetric = projectionMeter.createGauge(
  "sevo.discovery.projection.pending_events",
);
const projectionPoisonMetric = projectionMeter.createGauge(
  "sevo.discovery.projection.poison_events",
);
const projectionBuffersMetric = projectionMeter.createGauge(
  "sevo.discovery.projection.unresolved_buffers",
);
const projectionReplayMetric = projectionMeter.createCounter(
  "sevo.discovery.projection.replayed_events",
);
const projectionRebuildMetric = projectionMeter.createCounter(
  "sevo.discovery.projection.rebuilds",
);
const projectionRebuildDurationMetric = projectionMeter.createHistogram(
  "sevo.discovery.projection.rebuild_duration",
  { unit: "ms" },
);

export const projectDiscoveryStoreEvent: OutboxEventHandler = async (event, sql) => {
  const changed =
    event.eventType === "StorePublished.v1"
      ? storePublishedV1Contract.parse(event)
      : storeUnpublishedV1Contract.parse(event);
  const publicationVersion =
    changed.payload.publicationVersion ?? changed.aggregateVersion;
  await sql`
    select pg_advisory_xact_lock_shared(
      hashtextextended('discovery-public-feed:rebuild', 0)
    )
  `;
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`discovery-store-feed:${changed.payload.storeId}`}, 0)
    )
  `;
  const current = await sql<
    Array<{ aggregateVersion: number; publicationVersion: number }>
  >`
    select aggregate_version as "aggregateVersion",
      publication_version as "publicationVersion"
    from discovery_store_feed_projections
    where store_id = ${changed.payload.storeId}
    for update
  `;
  const projected = current[0];
  if (
    projected &&
    (publicationVersion < projected.publicationVersion ||
      (publicationVersion === projected.publicationVersion &&
        changed.aggregateVersion <= projected.aggregateVersion))
  ) {
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
  const productId = productIdFor(event);
  await sql`
    select pg_advisory_xact_lock_shared(
      hashtextextended('discovery-public-feed:rebuild', 0)
    )
  `;
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`discovery-product-feed:${productId}`}, 0)
    )
  `;
  if (event.eventType === "ProductPublished.v2") {
    await projectPublication(productPublishedV2Contract.parse(event), sql);
  } else if (event.eventType === "ProductPublished.v1") {
    await projectPublication(readLegacyProductPublication(event), sql);
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
  published: ProductPublicationMetadata,
  sql: Parameters<OutboxEventHandler>[1],
) {
  const rows = await sql<ProductProjectionRow[]>`
    select publication_version as "publicationVersion",
      product_aggregate_version as "productAggregateVersion", published,
      first_published_at as "firstPublishedAt", eligible_since as "eligibleSince",
      publication_updated_at as "publicationUpdatedAt",
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
         availability_version, publication_updated_at, updated_at)
      values
        (${published.payload.productId}, ${published.payload.storeId},
         ${published.aggregateVersion}, ${published.payload.publicationVersion},
         true, ${occurredAt}, ${occurredAt}, ${published.payload.offerVersion},
         ${published.payload.availabilityVersion}, ${occurredAt}, ${occurredAt})
    `;
  } else if (published.payload.publicationVersion < current.publicationVersion) {
    await sql`
      update discovery_product_feed_projections set
        first_published_at = least(first_published_at, ${occurredAt}),
        updated_at = greatest(updated_at, ${occurredAt})
      where product_id = ${published.payload.productId}
    `;
    return;
  } else if (
    published.payload.publicationVersion > current.publicationVersion ||
    published.aggregateVersion > current.productAggregateVersion
  ) {
    await sql`
      update discovery_product_feed_projections set
        store_id = ${published.payload.storeId},
        product_aggregate_version = ${published.aggregateVersion},
        publication_version = ${published.payload.publicationVersion},
        published = true,
        eligible_since = case when published then eligible_since else ${occurredAt} end,
        first_published_at = least(first_published_at, ${occurredAt}),
        publication_updated_at = ${occurredAt},
        offer_version = greatest(offer_version, ${published.payload.offerVersion}),
        availability_version = greatest(
          availability_version, ${published.payload.availabilityVersion}
        ),
        updated_at = greatest(updated_at, ${occurredAt})
      where product_id = ${published.payload.productId}
    `;
  } else {
    await sql`
      update discovery_product_feed_projections set
        first_published_at = least(first_published_at, ${occurredAt}),
        updated_at = greatest(updated_at, ${occurredAt})
      where product_id = ${published.payload.productId}
    `;
    return;
  }

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
  const rows = await sql<
    Array<{ aggregateVersion: number; publicationVersion: number }>
  >`
    select product_aggregate_version as "aggregateVersion",
      publication_version as "publicationVersion"
    from discovery_product_feed_projections
    where product_id = ${unpublished.payload.productId}
    for update
  `;
  const current = rows[0];
  if (current && unpublished.payload.publicationVersion < current.publicationVersion) {
    await sql`
      update discovery_product_feed_projections set
        eligible_since = greatest(eligible_since, publication_updated_at),
        updated_at = greatest(updated_at, ${unpublished.occurredAt})
      where product_id = ${unpublished.payload.productId}
    `;
    return;
  }
  if (
    current &&
    current.publicationVersion === unpublished.payload.publicationVersion &&
    current.aggregateVersion >= unpublished.aggregateVersion
  ) {
    return;
  }
  if (current) {
    await sql`
    update discovery_product_feed_projections set
      product_aggregate_version = ${unpublished.aggregateVersion},
      publication_version = ${unpublished.payload.publicationVersion},
      published = false,
      updated_at = greatest(updated_at, ${unpublished.occurredAt})
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
     set ${column} = $1, updated_at = greatest(updated_at, $2)
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
       set ${column} = greatest(${column}, $1),
         updated_at = case when ${column} < $1 then greatest(updated_at, $3)
           else updated_at end
       where product_id = $2`,
      [buffer.version, productId, buffer.updatedAt],
    );
  }
  await sql`
    delete from discovery_product_feed_version_buffers
    where product_id = ${productId} and publication_version <= ${publicationVersion}
  `;
}

function productIdFor(event: Parameters<OutboxEventHandler>[0]): string {
  if (event.eventType === "VariantPriceChanged.v1") {
    return variantPriceChangedV1Contract.parse(event).payload.productId;
  }
  if (event.eventType === "VariantAvailabilityChanged.v1") {
    return variantAvailabilityChangedV1Contract.parse(event).payload.productId;
  }
  return event.aggregateId;
}

export async function reconcileDiscoveryProjectionHealth(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const status = await sql.begin((transaction) =>
      reconcileProjectionHealth(transaction),
    );
    console.log(
      JSON.stringify({
        level: status.healthy ? "info" : "error",
        message: status.healthy
          ? "discovery_projection_health"
          : "discovery_projection_alert",
        healthy: status.healthy,
        reason: status.reason,
        lagMs: status.lagMs,
        pendingEventCount: status.pendingEvents,
        poisonEventCount: status.poisonEvents,
        unresolvedBufferCount: status.unresolvedBuffers,
      }),
    );
    recordProjectionHealthMetrics(status);
  } finally {
    await sql.end();
  }
}

export async function rebuildDiscoveryPublicFeedProjection(
  databaseUrl: string,
  log: ProjectionLog = (record) => console.log(JSON.stringify(record)),
) {
  const sql = postgres(databaseUrl, { max: 1 });
  const startedAt = Date.now();
  try {
    const result = await sql.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended('discovery-public-feed:rebuild', 0)
        )
      `;
      await transaction`
        update discovery_projection_status
        set healthy = false, reason = 'REBUILDING',
          updated_at = '1970-01-01T00:00:00.000Z'
        where projection_name = 'public-feed-v1'
      `;
      await transaction`delete from discovery_product_feed_version_buffers`;
      await transaction`delete from discovery_product_feed_projections`;
      await transaction`delete from discovery_store_feed_projections`;
      const replayedEventCount = await replayOutboxEventHistory(transaction, {
        eventTypes: discoveryFeedProjectionEventTypes,
        handler: dispatchDiscoveryProjectionEvent,
      });
      const health = await reconcileProjectionHealth(transaction);
      return { replayedEventCount, health };
    });
    log({
      level: result.health.healthy ? "info" : "error",
      message: result.health.healthy
        ? "discovery_projection_rebuild_completed"
        : "discovery_projection_rebuild_completed_unhealthy",
      replayedEventCount: result.replayedEventCount,
      durationMs: Date.now() - startedAt,
      lagMs: result.health.lagMs,
      poisonEventCount: result.health.poisonEvents,
      unresolvedBufferCount: result.health.unresolvedBuffers,
    });
    projectionRebuildMetric.add(1, {
      outcome: result.health.healthy ? "healthy" : "unhealthy",
    });
    projectionRebuildDurationMetric.record(Date.now() - startedAt, {
      outcome: result.health.healthy ? "healthy" : "unhealthy",
    });
    projectionReplayMetric.add(result.replayedEventCount, { operation: "rebuild" });
    return result;
  } catch (error) {
    log({
      level: "error",
      message: "discovery_projection_rebuild_failed",
      durationMs: Date.now() - startedAt,
      errorKind: error instanceof Error ? error.name : "UnknownError",
    });
    projectionRebuildMetric.add(1, { outcome: "failed" });
    projectionRebuildDurationMetric.record(Date.now() - startedAt, {
      outcome: "failed",
    });
    throw error;
  } finally {
    await sql.end();
  }
}

export async function catchUpDiscoveryPublicFeedProjection(
  databaseUrl: string,
  log: ProjectionLog = (record) => console.log(JSON.stringify(record)),
) {
  const result = await catchUpOutboxConsumer(databaseUrl, {
    consumerName: "discovery-public-feed-v1",
    handlers: Object.fromEntries(
      discoveryFeedProjectionEventTypes.map((eventType) => [
        eventType,
        dispatchDiscoveryProjectionEvent,
      ]),
    ),
    log: (record) =>
      log({
        ...record,
        message: "discovery_projection_catchup_failed",
      }),
  });
  if (result.replayedEventCount > 0) {
    log({
      level: "info",
      message: "discovery_projection_catchup_completed",
      replayedEventCount: result.replayedEventCount,
    });
    projectionReplayMetric.add(result.replayedEventCount, { operation: "catchup" });
  }
  return result;
}

function recordProjectionHealthMetrics(status: {
  healthy: boolean;
  lagMs: number;
  pendingEvents: number;
  poisonEvents: number;
  unresolvedBuffers: number;
}) {
  projectionHealthyMetric.record(status.healthy ? 1 : 0);
  projectionLagMetric.record(status.lagMs);
  projectionPendingMetric.record(status.pendingEvents);
  projectionPoisonMetric.record(status.poisonEvents);
  projectionBuffersMetric.record(status.unresolvedBuffers);
}

async function dispatchDiscoveryProjectionEvent(
  event: StoredOutboxEvent,
  sql: Parameters<OutboxEventHandler>[1],
) {
  if (
    event.eventType === "StorePublished.v1" ||
    event.eventType === "StoreUnpublished.v1"
  ) {
    await projectDiscoveryStoreEvent(event, sql);
  } else {
    await projectDiscoveryProductEvent(event, sql);
  }
}

async function reconcileProjectionHealth(
  sql: Parameters<OutboxEventHandler>[1],
  processedEventOccurredAt?: string,
) {
  const [backlog, bufferRows] = await Promise.all([
    readOutboxConsumerBacklog(sql, {
      consumerName: "discovery-public-feed-v1",
      eventTypes: discoveryFeedProjectionEventTypes,
    }),
    sql<Array<{ unresolvedBuffers: number }>>`
      select count(*)::int as "unresolvedBuffers"
      from discovery_product_feed_version_buffers
    `,
  ]);
  const counts = {
    ...backlog,
    unresolvedBuffers: bufferRows[0]?.unresolvedBuffers ?? 1,
  };
  const reason =
    counts.poisonEvents > 0
      ? "POISON_EVENT"
      : counts.unresolvedBuffers > 0
        ? "UNRESOLVED_BUFFERS"
        : counts.lagMs > discoveryProjectionOperationsV1.maxLagMs
          ? "PROJECTION_LAG"
          : null;
  await sql`
    update discovery_projection_status
    set healthy = ${reason === null}, reason = ${reason},
      updated_at = case when ${processedEventOccurredAt ?? null}::timestamptz is null
        then updated_at
        else greatest(updated_at, ${processedEventOccurredAt ?? null}::timestamptz)
      end
    where projection_name = 'public-feed-v1'
  `;
  return { healthy: reason === null, reason, ...counts };
}
