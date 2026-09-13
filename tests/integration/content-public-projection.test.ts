import { randomUUID } from "node:crypto";

import { salesContentPublishedV1Contract } from "@sevo/contracts/content/v1";
import { productUnpublishedV1Contract } from "@sevo/contracts/product/v1";
import {
  storePublishedV1Contract,
  storeUnpublishedV1Contract,
} from "@sevo/contracts/store/v1";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { projectPublicSalesContent } from "../../apps/worker/src/modules/content/index";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const ids = {
  store: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
  otherStore: "bd75d73c-1744-422c-a6ae-31195ed6abf2",
  product: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
  replacementProduct: "b78fdcc0-caad-4315-a7cd-b22834fe76d5",
  media: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
  replacementMedia: "907c619f-a989-4fd9-8b78-a437a07c7bc5",
  content: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
};

describe("public sales-content projection", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from content_public_sales_content_products`;
    await sql`delete from content_public_sales_contents`;
    await sql`delete from content_public_product_states`;
    await sql`delete from content_public_store_states`;
    await sql`update content_public_sales_content_status set updated_at = now()`;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("serves event-projected content and updates purchase availability from product events", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const publishedAt = "2026-09-01T09:00:00.000Z";
    await project(
      sql,
      storePublishedV1Contract.parse({
        ...envelope("StorePublished.v1", ids.store, 1, publishedAt),
        payload: {
          storeId: ids.store,
          publicationStatus: "PUBLISHED",
          publicationVersion: 1,
        },
      }),
    );
    const published = salesContentPublishedV1Contract.parse({
      ...envelope("SalesContentPublished.v1", ids.content, 1, publishedAt),
      payload: {
        contentId: ids.content,
        source: "SELLER",
        storeId: ids.store,
        media: { mediaId: ids.media, kind: "VIDEO" },
        productIds: [ids.product],
        moderationState: "PUBLISHED",
      },
    });
    await project(sql, published);

    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const visible = await server.inject({
      method: "GET",
      url: `/v2/sales-content?storeIds=${ids.store}`,
    });

    expect(visible.statusCode).toBe(200);
    expect(visible.json()).toMatchObject({
      projectionUpdatedAt: expect.any(String),
      items: [
        {
          contentId: ids.content,
          source: "SELLER",
          storeId: ids.store,
          media: { mediaId: ids.media, kind: "VIDEO" },
          products: [{ productId: ids.product, active: true }],
          publishedAt,
        },
      ],
    });
    expect(JSON.stringify(visible.json())).not.toMatch(
      /actorIdentityId|buyerId|orderItemId|viewCount|likeCount/i,
    );

    await project(
      sql,
      salesContentPublishedV1Contract.parse({
        ...envelope(
          "SalesContentPublished.v1",
          ids.content,
          2,
          "2026-09-01T09:15:00.000Z",
        ),
        payload: {
          contentId: ids.content,
          source: "SELLER",
          storeId: ids.store,
          media: { mediaId: ids.replacementMedia, kind: "IMAGE" },
          productIds: [ids.replacementProduct],
          moderationState: "PUBLISHED",
        },
      }),
    );
    const replaced = await server.inject({
      method: "GET",
      url: `/v2/sales-content?storeIds=${ids.store}`,
    });
    expect(replaced.json().items[0]).toMatchObject({
      media: { mediaId: ids.replacementMedia, kind: "IMAGE" },
      products: [{ productId: ids.replacementProduct, active: true }],
      publishedAt,
    });

    const stopped = productUnpublishedV1Contract.parse({
      ...envelope(
        "ProductUnpublished.v1",
        ids.replacementProduct,
        2,
        "2026-09-01T09:30:00.000Z",
      ),
      payload: {
        storeId: ids.store,
        productId: ids.replacementProduct,
        publicationVersion: 1,
      },
    });
    await project(sql, stopped);
    const unavailable = await server.inject({
      method: "GET",
      url: `/v2/sales-content?storeIds=${ids.store}`,
    });
    expect(unavailable.json().items[0].products).toEqual([
      { productId: ids.replacementProduct, active: false },
    ]);

    const unrelated = await server.inject({
      method: "GET",
      url: `/v2/sales-content?storeIds=${ids.otherStore}`,
    });
    expect(unrelated.statusCode).toBe(200);
    expect(unrelated.json().items).toEqual([]);

    await project(
      sql,
      storeUnpublishedV1Contract.parse({
        ...envelope("StoreUnpublished.v1", ids.store, 2, "2026-09-01T10:00:00.000Z"),
        payload: {
          storeId: ids.store,
          publicationStatus: "DRAFT",
          publicationVersion: 2,
        },
      }),
    );
    const hiddenStore = await server.inject({
      method: "GET",
      url: `/v2/sales-content?storeIds=${ids.store}`,
    });
    expect(hiddenStore.json().items).toEqual([]);
    await sql.end();
  });

  it("keeps an early product stop when sales content arrives later", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const at = "2026-09-01T11:00:00.000Z";
    await project(
      sql,
      storePublishedV1Contract.parse({
        ...envelope("StorePublished.v1", ids.store, 1, at),
        payload: {
          storeId: ids.store,
          publicationStatus: "PUBLISHED",
          publicationVersion: 1,
        },
      }),
    );
    await project(
      sql,
      productUnpublishedV1Contract.parse({
        ...envelope("ProductUnpublished.v1", ids.product, 3, at),
        payload: {
          storeId: ids.store,
          productId: ids.product,
          publicationVersion: 2,
        },
      }),
    );
    await project(
      sql,
      salesContentPublishedV1Contract.parse({
        ...envelope("SalesContentPublished.v1", ids.content, 1, at),
        payload: {
          contentId: ids.content,
          source: "SELLER",
          storeId: ids.store,
          media: { mediaId: ids.media, kind: "IMAGE" },
          productIds: [ids.product],
          moderationState: "PUBLISHED",
        },
      }),
    );
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/v2/sales-content?storeIds=${ids.store}`,
      });
    expect(response.json().items[0].products).toEqual([
      { productId: ids.product, active: false },
    ]);
    await sql.end();
  });
});

async function project(
  sql: ReturnType<typeof postgres>,
  event: Parameters<typeof projectPublicSalesContent>[0],
) {
  await sql.begin((transaction) => projectPublicSalesContent(event, transaction));
}

function envelope(
  eventType: string,
  aggregateId: string,
  aggregateVersion: number,
  occurredAt: string,
) {
  return {
    version: 1 as const,
    eventId: randomUUID(),
    eventType,
    aggregateId,
    aggregateVersion,
    occurredAt,
    correlationId: randomUUID(),
    causationId: randomUUID(),
    actor: { type: "SYSTEM" as const },
  };
}
