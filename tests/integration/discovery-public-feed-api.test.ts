import { createHash } from "node:crypto";

import { discoveryFeedProjectionEventTypes } from "@sevo/contracts/discovery/v1";
import { productPublishedV2Contract } from "@sevo/contracts/product/v1";
import { storePublishedV1Contract } from "@sevo/contracts/store/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import {
  projectDiscoveryProductEvent,
  projectDiscoveryStoreEvent,
} from "../../apps/worker/src/modules/discovery/project-public-feed";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const storeId = "10000000-0000-4000-8000-000000000001";
const sellerId = "10000000-0000-4000-8000-000000000002";
const buyerId = "10000000-0000-4000-8000-000000000003";
const buyerSessionToken = "discovery-buyer-session-token";
const products = [1, 2, 3].map((suffix) => ({
  productId: `20000000-0000-4000-9000-${String(suffix).padStart(12, "0")}`,
  variantId: `30000000-0000-4000-a000-${String(suffix).padStart(12, "0")}`,
  mediaId: `40000000-0000-4000-b000-${String(suffix).padStart(12, "0")}`,
  publishedAt: `2026-08-${20 + suffix}T10:00:00.000Z`,
}));

describe("public discovery feed HTTP API", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from discovery_product_feed_version_buffers`;
    await sql`delete from discovery_product_feed_projections`;
    await sql`delete from discovery_store_feed_projections`;
    await sql`delete from inventory_levels where store_id = ${storeId}`;
    await sql`delete from product_products where store_id = ${storeId}`;
    await sql`delete from store_stores where id = ${storeId}`;
    await sql`
      update discovery_projection_status
      set healthy = true, reason = null, updated_at = now()
      where projection_name = 'public-feed-v1'
    `;
    await seedAuthoritativeData(sql);
    await sql`
      insert into platform_outbox_consumptions (consumer_name, event_id, consumed_at)
      select 'discovery-public-feed-v1', event_id, now()
      from platform_outbox_events
      where event_type in ${sql(discoveryFeedProjectionEventTypes)}
      on conflict (consumer_name, event_id) do nothing
    `;
    await projectEvents(sql);
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("returns identical deterministic pages for a guest and a signed-in buyer", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`
      insert into identity_identities (id, status)
      values (${buyerId}, 'ACTIVE')
      on conflict (id) do update set status = 'ACTIVE'
    `;
    await sql`
      insert into identity_sessions (id, token_hash, identity_id, audience, expires_at)
      values (${crypto.randomUUID()},
        ${createHash("sha256").update(buyerSessionToken).digest("hex")},
        ${buyerId}, 'PUBLIC', now() + interval '1 hour')
    `;
    await sql.end();
    const cookie = `sevo_session=${buyerSessionToken}`;

    const readAllPages = async (sessionCookie?: string) => {
      const seen: string[] = [];
      let cursor: string | undefined;
      let firstResponse: Awaited<ReturnType<typeof server.inject>> | undefined;
      do {
        const page = await server.inject({
          method: "GET",
          url: `/v1/feeds/discovery?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          ...(sessionCookie ? { headers: { cookie: sessionCookie } } : {}),
        });
        firstResponse ??= page;
        expect(page.statusCode, page.body).toBe(200);
        const body = page.json<{
          items: Array<{ productId: string }>;
          nextCursor?: string;
        }>();
        seen.push(...body.items.map(({ productId }) => productId));
        cursor = body.nextCursor;
      } while (cursor);
      return { seen, firstResponse: firstResponse! };
    };

    const guest = await readAllPages();
    const buyer = await readAllPages(cookie);
    expect(buyer.seen).toEqual(guest.seen);
    expect(guest.firstResponse.headers["cache-control"]).toContain("public");
    expect(guest.firstResponse.headers).toHaveProperty("x-projection-lag-ms");
    expect(JSON.stringify(guest.firstResponse.json())).not.toMatch(
      /identity|viewer|follow|viewCount|like|score/i,
    );
    expect(guest.seen).toHaveLength(3);
    expect(new Set(guest.seen).size).toBe(3);
  });

  it("skips a product that stops being authoritative after the snapshot", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const first = await server.inject({
      method: "GET",
      url: "/v1/feeds/discovery?limit=1",
    });
    const cursor = first.json<{ nextCursor: string }>().nextCursor;
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`
      update product_products set state = 'DRAFT'
      where id = ${products[1]!.productId}
    `;
    await sql.end();

    const continued = await server.inject({
      method: "GET",
      url: `/v1/feeds/discovery?limit=1&cursor=${encodeURIComponent(cursor)}`,
    });
    expect(continued.statusCode).toBe(200);
    expect(continued.json().items).toHaveLength(1);
    expect(continued.json().items[0].productId).toBe(products[0]!.productId);
    expect(continued.json()).not.toHaveProperty("nextCursor");
  });

  it("rejects a tampered cursor and exposes projection recovery", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const first = await server.inject({
      method: "GET",
      url: "/v1/feeds/discovery?limit=1",
    });
    const cursor = first.json<{ nextCursor: string }>().nextCursor;
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;
    const invalid = await server.inject({
      method: "GET",
      url: `/v1/feeds/discovery?limit=1&cursor=${encodeURIComponent(tampered)}`,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "INVALID_CURSOR" });

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const recentPending = storePublishedV1Contract.parse({
      ...envelope("StorePublished.v1", storeId, 2, new Date().toISOString()),
      payload: {
        storeId,
        publicationStatus: "PUBLISHED",
        publicationVersion: 1,
      },
    });
    await sql.begin((transaction) => enqueueOutboxEvent(transaction, recentPending));
    const withinSlo = await server.inject({
      method: "GET",
      url: "/v1/feeds/discovery",
    });
    expect(withinSlo.statusCode).toBe(200);
    await sql`delete from platform_outbox_events where event_id = ${recentPending.eventId}`;

    const pending = storePublishedV1Contract.parse({
      ...envelope("StorePublished.v1", storeId, 2, "2026-08-24T10:00:00.000Z"),
      payload: {
        storeId,
        publicationStatus: "PUBLISHED",
        publicationVersion: 1,
      },
    });
    await sql.begin((transaction) => enqueueOutboxEvent(transaction, pending));
    const unavailable = await server.inject({
      method: "GET",
      url: "/v1/feeds/discovery",
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.headers["retry-after"]).toBe("5");
    expect(unavailable.json()).toMatchObject({
      code: "PROJECTION_UNAVAILABLE",
      message: expect.stringContaining("دوباره تلاش کنید"),
    });
    await sql`delete from platform_outbox_events where event_id = ${pending.eventId}`;

    const poison = storePublishedV1Contract.parse({
      ...envelope("StorePublished.v1", storeId, 2, new Date().toISOString()),
      payload: {
        storeId,
        publicationStatus: "PUBLISHED",
        publicationVersion: 1,
      },
    });
    await sql.begin((transaction) => enqueueOutboxEvent(transaction, poison));
    await sql`
      update platform_outbox_events set status = 'FAILED', failed_at = now(),
        attempt_count = 5, last_error = 'ZodError'
      where event_id = ${poison.eventId}
    `;
    const poisoned = await server.inject({
      method: "GET",
      url: "/v1/feeds/discovery",
    });
    expect(poisoned.statusCode).toBe(503);
    await sql`delete from platform_outbox_events where event_id = ${poison.eventId}`;
    await sql.end();
  });
});

async function seedAuthoritativeData(sql: ReturnType<typeof postgres>) {
  await sql`
    insert into store_stores
      (id, name, slug, bio, return_policy, settlement_kind, settlement_status,
       settlement_verified_at, theme_color, status, published_at,
       publication_version, revision, return_policy_revision, updated_at)
    values
      (${storeId}, 'خانه سفال', 'khane-sofal', 'سفال دست‌ساز برای خانه',
       'تا هفت روز امکان درخواست مرجوعی وجود دارد.', 'TEST', 'TEST_VERIFIED',
       now(), '#A41439', 'PUBLISHED', '2026-08-20T10:00:00.000Z', 1, 2, 1,
       '2026-08-20T10:00:00.000Z')
  `;
  await sql`
    insert into store_memberships (id, store_id, seller_id, role)
    values (${crypto.randomUUID()}, ${storeId}, ${sellerId}, 'OWNER')
  `;
  await sql`
    insert into store_shipping_methods
      (id, store_id, position, revision, code, label, fixed_fee_amount,
       currency, estimated_delivery_text, enabled, requires_delivery_address,
       requires_postal_code)
    values
      (${crypto.randomUUID()}, ${storeId}, 0, 1, 'NATIONAL_POST', 'پست پیشتاز',
       0, 'IRR', 'دو تا چهار روز کاری', true, true, true)
  `;
  for (const [index, product] of products.entries()) {
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at,
         created_at, updated_at)
      values
        (${product.productId}, ${storeId}, 'PUBLISHED', 2, 1,
         ${product.publishedAt}, ${product.publishedAt}, ${product.publishedAt})
    `;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id, variant_id)
      values
        (${product.productId}, 1, ${`فنجان دست‌ساز ${index + 1}`},
         'فنجان مناسب نوشیدنی گرم', ${product.mediaId}, ${product.variantId})
    `;
    await sql`
      insert into product_offers
        (product_id, variant_id, amount, currency, revision)
      values (${product.productId}, ${product.variantId}, ${1_000_000 + index * 10}, 'IRR', 1)
    `;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${product.variantId}, ${storeId}, 5, 1)
    `;
  }
}

async function projectEvents(sql: ReturnType<typeof postgres>) {
  const storeEvent = storePublishedV1Contract.parse({
    ...envelope("StorePublished.v1", storeId, 2, "2026-08-20T10:00:00.000Z"),
    payload: {
      storeId,
      publicationStatus: "PUBLISHED",
      publicationVersion: 1,
    },
  });
  await sql.begin((transaction) => projectDiscoveryStoreEvent(storeEvent, transaction));
  for (const product of products) {
    const event = productPublishedV2Contract.parse({
      ...envelope("ProductPublished.v2", product.productId, 2, product.publishedAt),
      payload: {
        storeId,
        productId: product.productId,
        publicationVersion: 1,
        snapshot: { variantIds: [product.variantId] },
        offerVersion: 1,
        availabilityVersion: 1,
      },
    });
    await sql.begin((transaction) => projectDiscoveryProductEvent(event, transaction));
  }
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
