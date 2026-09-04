import {
  productPublishedV1Contract,
  productPublishedV2Contract,
  productUnpublishedV1Contract,
} from "@sevo/contracts/product/v1";
import { salesContentPublishedV1Contract } from "@sevo/contracts/content/v1";
import {
  storePublishedV1Contract,
  storeUnpublishedV1Contract,
} from "@sevo/contracts/store/v1";
import { DurableOutboxWorker, type OutboxEventHandler } from "@sevo/outbox";

import type { WorkerHandler } from "../public";

export const projectContentProductState: OutboxEventHandler = async (event, sql) => {
  const product =
    event.eventType === "ProductPublished.v1"
      ? productPublishedV1Contract.parse(event)
      : event.eventType === "ProductPublished.v2"
        ? productPublishedV2Contract.parse(event)
        : productUnpublishedV1Contract.parse(event);
  const active = product.eventType !== "ProductUnpublished.v1";
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`content-product-state:${product.payload.productId}`}, 0)
    )
  `;
  const applied = await sql<Array<{ productId: string }>>`
    insert into content_product_states
      (product_id, aggregate_version, publication_version, active, updated_at)
    values
      (${product.payload.productId}, ${product.aggregateVersion},
       ${product.payload.publicationVersion}, ${active}, ${product.occurredAt})
    on conflict (product_id) do update
    set aggregate_version = excluded.aggregate_version,
        publication_version = excluded.publication_version,
        active = excluded.active,
        updated_at = excluded.updated_at
    where content_product_states.aggregate_version < excluded.aggregate_version
    returning product_id as "productId"
  `;
  if (applied.length === 0) return;
  const affected = await sql<Array<{ contentId: string }>>`
    update content_sales_content_products
    set active = ${active}
    where product_id = ${product.payload.productId}
    returning content_id as "contentId"
  `;
  if (affected.length === 0) return;
  const contentIds = [...new Set(affected.map(({ contentId }) => contentId))];
  await sql`
    update content_sales_contents content
    set active = exists (
      select 1 from content_sales_content_products product_link
      where product_link.content_id = content.id and product_link.active
    )
    where content.id in ${sql(contentIds)}
  `;
};

export const projectPublicSalesContent: OutboxEventHandler = async (event, sql) => {
  if (
    event.eventType === "StorePublished.v1" ||
    event.eventType === "StoreUnpublished.v1"
  ) {
    const store =
      event.eventType === "StorePublished.v1"
        ? storePublishedV1Contract.parse(event)
        : storeUnpublishedV1Contract.parse(event);
    const publicationVersion =
      store.payload.publicationVersion ?? store.aggregateVersion;
    await sql`
      insert into content_public_store_states
        (store_id, aggregate_version, publication_version, published, updated_at)
      values (${store.payload.storeId}, ${store.aggregateVersion},
        ${publicationVersion}, ${store.eventType === "StorePublished.v1"},
        ${store.occurredAt})
      on conflict (store_id) do update set
        aggregate_version = excluded.aggregate_version,
        publication_version = excluded.publication_version,
        published = excluded.published,
        updated_at = excluded.updated_at
      where content_public_store_states.publication_version < excluded.publication_version
        or (content_public_store_states.publication_version = excluded.publication_version
          and content_public_store_states.aggregate_version < excluded.aggregate_version)
    `;
    await markPublicProjectionUpdated(sql, store.occurredAt);
    return;
  }

  if (event.eventType === "SalesContentPublished.v1") {
    const content = salesContentPublishedV1Contract.parse(event);
    const applied = await sql<Array<{ contentId: string }>>`
      insert into content_public_sales_contents
        (content_id, store_id, source, moderation_state, media_id, media_kind,
         aggregate_version, published_at, updated_at)
      values
        (${content.payload.contentId}, ${content.payload.storeId},
         ${content.payload.source}, ${content.payload.moderationState},
         ${content.payload.media.mediaId}, ${content.payload.media.kind},
         ${content.aggregateVersion}, ${content.occurredAt}, ${content.occurredAt})
      on conflict (content_id) do update
      set store_id = excluded.store_id, source = excluded.source,
          moderation_state = excluded.moderation_state,
          media_id = excluded.media_id, media_kind = excluded.media_kind,
          aggregate_version = excluded.aggregate_version,
          published_at = excluded.published_at, updated_at = excluded.updated_at
      where content_public_sales_contents.aggregate_version < excluded.aggregate_version
      returning content_id as "contentId"
    `;
    if (applied.length === 0) return;
    for (const productId of [...content.payload.productIds].sort()) {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`content-public-product-state:${productId}`}, 0)
        )
      `;
      await sql`
        insert into content_public_sales_content_products
          (content_id, product_id, active, last_product_aggregate_version,
           last_product_occurred_at)
        select ${content.payload.contentId}, ${productId},
          coalesce(state.active, true), coalesce(state.aggregate_version, 0),
          coalesce(state.updated_at, ${content.occurredAt})
        from (values (1)) as seed(value)
        left join content_public_product_states state
          on state.product_id = ${productId}
        on conflict (content_id, product_id) do update
        set active = excluded.active,
            last_product_aggregate_version = excluded.last_product_aggregate_version,
            last_product_occurred_at = excluded.last_product_occurred_at
        where content_public_sales_content_products.last_product_aggregate_version
          < excluded.last_product_aggregate_version
      `;
    }
    await markPublicProjectionUpdated(sql, content.occurredAt);
    return;
  }

  const product =
    event.eventType === "ProductPublished.v1"
      ? productPublishedV1Contract.parse(event)
      : event.eventType === "ProductPublished.v2"
        ? productPublishedV2Contract.parse(event)
        : productUnpublishedV1Contract.parse(event);
  const active = product.eventType !== "ProductUnpublished.v1";
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended(
        ${`content-public-product-state:${product.payload.productId}`}, 0
      )
    )
  `;
  await sql`
    insert into content_public_product_states
      (product_id, aggregate_version, publication_version, active, updated_at)
    values (${product.payload.productId}, ${product.aggregateVersion},
      ${product.payload.publicationVersion}, ${active}, ${product.occurredAt})
    on conflict (product_id) do update set
      aggregate_version = excluded.aggregate_version,
      publication_version = excluded.publication_version,
      active = excluded.active,
      updated_at = excluded.updated_at
    where content_public_product_states.aggregate_version < excluded.aggregate_version
  `;
  const affected = await sql`
    update content_public_sales_content_products
    set active = ${active},
        last_product_aggregate_version = ${product.aggregateVersion},
        last_product_occurred_at = ${product.occurredAt}
    where product_id = ${product.payload.productId}
      and last_product_aggregate_version < ${product.aggregateVersion}
    returning content_id
  `;
  if (affected.length > 0) await markPublicProjectionUpdated(sql, product.occurredAt);
};

async function markPublicProjectionUpdated(
  sql: Parameters<OutboxEventHandler>[1],
  occurredAt: string,
) {
  await sql`
    update content_public_sales_content_status
    set updated_at = greatest(updated_at, ${occurredAt})
    where projection_name = 'public-sales-content-v2'
  `;
}

const productStateWorker: WorkerHandler = {
  async start(environment) {
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName: "content-product-state-v1",
      handlers: {
        "ProductPublished.v1": projectContentProductState,
        "ProductPublished.v2": projectContentProductState,
        "ProductUnpublished.v1": projectContentProductState,
      },
    });
    await worker.start();
    return () => worker.close();
  },
};

const publicSalesContentWorker: WorkerHandler = {
  async start(environment) {
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName: "content-public-sales-content-v2",
      handlers: {
        "SalesContentPublished.v1": projectPublicSalesContent,
        "ProductPublished.v1": projectPublicSalesContent,
        "ProductPublished.v2": projectPublicSalesContent,
        "ProductUnpublished.v1": projectPublicSalesContent,
        "StorePublished.v1": projectPublicSalesContent,
        "StoreUnpublished.v1": projectPublicSalesContent,
      },
    });
    await worker.start();
    return () => worker.close();
  },
};

export const content_workerHandlers: readonly WorkerHandler[] = [
  productStateWorker,
  publicSalesContentWorker,
];
