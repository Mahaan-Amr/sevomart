import {
  productPublishedV1Contract,
  productPublishedV2Contract,
  variantAvailabilityChangedV1Contract,
  variantPriceChangedV1Contract,
} from "@sevo/contracts/product/v1";
import {
  storePublishedV1Contract,
  storeUnpublishedV1Contract,
} from "@sevo/contracts/store/v1";
import type { OutboxEventHandler } from "@sevo/outbox";

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
  if ((current[0]?.aggregateVersion ?? 0) >= changed.aggregateVersion) return;

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
  await markProjectionUpdated(sql, changed.occurredAt);
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
    return;
  }
  if (event.eventType === "VariantPriceChanged.v1") {
    const price = variantPriceChangedV1Contract.parse(event);
    await projectVersion(
      price.payload.productId,
      price.payload.publicationVersion,
      "OFFER",
      price.payload.offerVersion,
      price.occurredAt,
      sql,
    );
    return;
  }
  const availability = variantAvailabilityChangedV1Contract.parse(event);
  await projectVersion(
    availability.payload.productId,
    availability.payload.publicationVersion,
    "AVAILABILITY",
    availability.payload.availabilityVersion,
    availability.occurredAt,
    sql,
  );
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
        first_published_at = least(first_published_at, ${occurredAt}),
        eligible_since = case when published then eligible_since else ${occurredAt} end,
        offer_version = greatest(offer_version, ${published.payload.offerVersion}),
        availability_version = greatest(
          availability_version, ${published.payload.availabilityVersion}
        ),
        updated_at = ${occurredAt}
      where product_id = ${published.payload.productId}
    `;
  } else {
    const updated = await sql`
      update discovery_product_feed_projections
      set first_published_at = least(first_published_at, ${occurredAt})
      where product_id = ${published.payload.productId}
        and first_published_at > ${occurredAt}
      returning product_id
    `;
    if (updated.length === 0) return;
  }

  await applyBufferedVersions(
    published.payload.productId,
    published.payload.publicationVersion,
    sql,
  );
  await markProjectionUpdated(sql, published.occurredAt);
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
  const updated = await sql.unsafe(
    `update discovery_product_feed_projections
     set ${column} = $1, updated_at = $2
     where product_id = $3 and ${column} < $1
     returning product_id`,
    [version, occurredAt, productId],
  );
  if (updated.length > 0) await markProjectionUpdated(sql, occurredAt);
}

async function applyBufferedVersions(
  productId: string,
  publicationVersion: number,
  sql: Parameters<OutboxEventHandler>[1],
) {
  const buffers = await sql<Array<{ kind: "OFFER" | "AVAILABILITY"; version: number }>>`
    select version_kind as kind, version
    from discovery_product_feed_version_buffers
    where product_id = ${productId} and publication_version = ${publicationVersion}
  `;
  for (const buffer of buffers) {
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

async function markProjectionUpdated(
  sql: Parameters<OutboxEventHandler>[1],
  occurredAt: string,
) {
  await sql`
    update discovery_projection_status
    set healthy = true, reason = null,
      updated_at = greatest(updated_at, ${occurredAt})
    where projection_name = 'public-feed-v1'
  `;
}
