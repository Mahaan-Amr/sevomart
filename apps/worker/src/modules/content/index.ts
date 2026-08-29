import {
  productPublishedV1Contract,
  productPublishedV2Contract,
  productUnpublishedV1Contract,
} from "@sevo/contracts/product/v1";
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

export const content_workerHandlers: readonly WorkerHandler[] = [productStateWorker];
