import { DurableOutboxWorker } from "@sevo/outbox";
import postgres from "postgres";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { discoveryFollowerCountOutboxHandlers } from "../../apps/worker/src/modules/discovery";
import {
  projectDiscoveryProductEvent,
  projectDiscoveryStoreEvent,
  rebuildDiscoveryPublicFeedProjection,
} from "../../apps/worker/src/modules/discovery/project-public-feed";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const environment = {
  ...apiTestEnvironment,
  DEV_OTP_TEST_MOBILES: ["09123456789", "09123456788"],
};

describe("discovery projection with real store, product and inventory producers", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from discovery_product_feed_version_buffers`;
    await sql`delete from discovery_product_feed_projections`;
    await sql`delete from discovery_store_feed_projections`;
    await sql`delete from discovery_follow_idempotency_records`;
    await sql`delete from discovery_follower_count_relation_projections`;
    await sql`delete from discovery_store_follows`;
    await sql`delete from discovery_follow_sets`;
    await sql`delete from discovery_public_follower_counts`;
    await sql`delete from discovery_identity_status_projections`;
    await sql`delete from platform_outbox_events`;
    await sql`delete from store_idempotency_records`;
    await sql`delete from store_stores`;
    await sql`delete from identity_otp_challenges`;
    await sql`
      update discovery_projection_status
      set healthy = true, reason = null, updated_at = now()
      where projection_name = 'public-feed-v1'
    `;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("keeps a snapshot stable while real availability and publication events project", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const cookie = await signIn(server, "09123456789", true);
    const buyerCookie = await signIn(server, "09123456788", false);
    const store = await publishStore(server, cookie);
    const products = await Promise.all([
      publishProduct(server, cookie, "فنجان آبی"),
      publishProduct(server, cookie, "فنجان زرشکی"),
    ]);

    await projectDiscoveryEvents();
    const followed = await server.inject({
      method: "PUT",
      url: `/v1/me/follows/${store.id}`,
      headers: {
        cookie: buyerCookie,
        "idempotency-key": crypto.randomUUID(),
      },
    });
    expect(followed.statusCode, followed.body).toBe(200);
    await projectFollowerCountEvents();
    const following = await server.inject({
      method: "GET",
      url: "/v1/me/feeds/following?limit=30",
      headers: { cookie: buyerCookie },
    });
    expect(following.statusCode, following.body).toBe(200);
    expect(following.json()).toMatchObject({
      visibleFollowedStoreCount: 1,
      followSetRevision: 1,
    });
    expect(following.json().items).toHaveLength(2);
    const publicStore = await server.inject({
      method: "GET",
      url: "/v1/stores/real-discovery-store",
    });
    expect(publicStore.json()).toMatchObject({ followerCount: { count: 1 } });

    const first = await server.inject({
      method: "GET",
      url: "/v1/feeds/discovery?limit=1",
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().items).toHaveLength(1);
    expect(first.json()).toHaveProperty("nextCursor");
    const firstProductId = first.json().items[0].productId as string;
    const continuedProduct = products.find(
      ({ productId }) => productId !== firstProductId,
    )!;

    const adjusted = await server.inject({
      method: "PUT",
      url: "/v1/seller/inventory",
      headers: {
        cookie,
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {
        reasonCode: "MANUAL_COUNT",
        rows: [
          {
            variantId: continuedProduct.variantId,
            onHand: 0,
            expectedRevision: 1,
          },
        ],
      },
    });
    expect(adjusted.statusCode, adjusted.body).toBe(200);
    await projectDiscoveryEvents();

    const continued = await server.inject({
      method: "GET",
      url: `/v1/feeds/discovery?limit=1&cursor=${encodeURIComponent(
        first.json().nextCursor,
      )}`,
    });
    expect(continued.statusCode, continued.body).toBe(200);
    expect(continued.json()).toMatchObject({
      snapshotAt: first.json().snapshotAt,
      items: [
        {
          productId: continuedProduct.productId,
          availability: "OUT_OF_STOCK",
        },
      ],
    });

    const fresh = await server.inject({
      method: "GET",
      url: "/v1/feeds/discovery?limit=1",
    });
    const unpublished = await server.inject({
      method: "POST",
      url: `/v1/seller/products/${continuedProduct.productId}/unpublication`,
      headers: writeHeaders(cookie, crypto.randomUUID(), continuedProduct.revision),
      payload: {
        expectedRevision: continuedProduct.revision,
        reasonCode: "SELLER_REQUEST",
      },
    });
    expect(unpublished.statusCode, unpublished.body).toBe(200);
    await projectDiscoveryEvents();

    const afterUnpublish = await server.inject({
      method: "GET",
      url: `/v1/feeds/discovery?limit=1&cursor=${encodeURIComponent(
        fresh.json().nextCursor,
      )}`,
    });
    expect(afterUnpublish.statusCode, afterUnpublish.body).toBe(200);
    expect(afterUnpublish.json().items).toEqual([]);
    expect(afterUnpublish.json()).not.toHaveProperty("nextCursor");

    const rebuilt = await rebuildDiscoveryPublicFeedProjection(
      apiTestEnvironment.DATABASE_URL,
      () => undefined,
    );
    expect(rebuilt.health.healthy).toBe(true);
    const afterRebuild = await server.inject({
      method: "GET",
      url: "/v1/feeds/discovery?limit=30",
    });
    expect(afterRebuild.statusCode, afterRebuild.body).toBe(200);
    expect(
      afterRebuild
        .json()
        .items.map(({ productId }: { productId: string }) => productId),
    ).toEqual([firstProductId]);
  });
});

type TestServer =
  Awaited<ReturnType<typeof createApiApp>> extends infer T
    ? T extends { getHttpAdapter(): { getInstance(): infer S } }
      ? S
      : never
    : never;

async function signIn(server: TestServer, mobile: string, seller: boolean) {
  const requested = await server.inject({
    method: "POST",
    url: "/v1/auth/otp/requests",
    payload: { mobile },
  });
  const verified = await server.inject({
    method: "POST",
    url: "/v1/auth/otp/verifications",
    payload: {
      challengeId: requested.json<{ challengeId: string }>().challengeId,
      code: "111111",
    },
  });
  if (seller) {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`
      insert into identity_seller_access (id, identity_id, status)
      select ${crypto.randomUUID()}::uuid, identity_id, 'ACTIVE'
      from identity_login_methods where mobile = ${mobile}
      on conflict (identity_id) do update set status = 'ACTIVE'
    `;
    await sql.end();
  }
  return verified.headers["set-cookie"]!;
}

async function publishStore(server: TestServer, cookie: string) {
  const saved = await server.inject({
    method: "PUT",
    url: "/v1/seller/store/draft",
    headers: writeHeaders(cookie, crypto.randomUUID(), 0),
    payload: {
      name: "خانه کشف واقعی",
      slug: "real-discovery-store",
      bio: "فروشگاه آزمایشی برای اتصال واقعی رخدادهای کشف",
      shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
      returnPolicy: "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.",
      settlementDestination: { kind: "TEST" },
      logoMediaId: null,
      coverMediaId: null,
      themeColor: "#A41439",
    },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const published = await server.inject({
    method: "POST",
    url: "/v1/seller/store/publication",
    headers: writeHeaders(cookie, crypto.randomUUID(), saved.json().revision),
  });
  expect(published.statusCode, published.body).toBe(200);
  return published.json<{ store: { id: string } }>().store;
}

async function publishProduct(server: TestServer, cookie: string, name: string) {
  const created = await server.inject({
    method: "POST",
    url: "/v1/seller/products",
    headers: { cookie, "idempotency-key": crypto.randomUUID() },
    payload: {},
  });
  expect(created.statusCode, created.body).toBe(201);
  const productId = created.json<{ productId: string }>().productId;
  const mediaId = await uploadProductImage(server, cookie, productId);
  const saved = await server.inject({
    method: "PUT",
    url: `/v1/seller/products/${productId}/working-copy`,
    headers: writeHeaders(cookie, crypto.randomUUID(), 0),
    payload: {
      expectedRevision: 0,
      workingCopy: {
        name,
        description: "فنجان دست‌ساز مناسب نوشیدنی گرم",
        orderedMediaIds: [mediaId],
        variant: {
          clientKey: "simple",
          price: { amount: 4_500_000, currency: "IRR" },
        },
      },
      inventory: { onHand: 3, expectedRevision: 0 },
    },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const published = await server.inject({
    method: "POST",
    url: `/v1/seller/products/${productId}/publications`,
    headers: writeHeaders(cookie, crypto.randomUUID(), saved.json().revision),
    payload: { expectedRevision: saved.json().revision, confirmed: true },
  });
  expect(published.statusCode, published.body).toBe(200);
  return {
    productId,
    variantId: published.json().variantId as string,
    revision: (saved.json().revision as number) + 1,
  };
}

async function uploadProductImage(
  server: TestServer,
  cookie: string,
  productId: string,
) {
  const source = await sharp({
    create: { width: 800, height: 800, channels: 4, background: "#A41439" },
  })
    .png()
    .toBuffer();
  const boundary = `discovery-image-${productId}`;
  const upload = await server.inject({
    method: "POST",
    url: `/v1/seller/products/${productId}/images`,
    headers: {
      cookie,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nPRODUCT_IMAGE\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="product.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      source,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  expect(upload.statusCode, upload.body).toBe(201);
  return upload.json<{ id: string }>().id;
}

async function projectDiscoveryEvents() {
  const worker = new DurableOutboxWorker(apiTestEnvironment.DATABASE_URL, {
    consumerName: "discovery-public-feed-v1",
    handlers: {
      "StorePublished.v1": projectDiscoveryStoreEvent,
      "StoreUnpublished.v1": projectDiscoveryStoreEvent,
      "ProductPublished.v1": projectDiscoveryProductEvent,
      "ProductPublished.v2": projectDiscoveryProductEvent,
      "ProductUnpublished.v1": projectDiscoveryProductEvent,
      "VariantPriceChanged.v1": projectDiscoveryProductEvent,
      "VariantAvailabilityChanged.v1": projectDiscoveryProductEvent,
    },
  });
  try {
    while ((await worker.runOnce()) !== "idle") {
      // Drain only the real producer events consumed by discovery.
    }
  } finally {
    await worker.close();
  }
}

async function projectFollowerCountEvents() {
  const worker = new DurableOutboxWorker(apiTestEnvironment.DATABASE_URL, {
    consumerName: "discovery-follower-count-v1",
    handlers: discoveryFollowerCountOutboxHandlers,
  });
  try {
    while ((await worker.runOnce()) !== "idle") {
      // Drain only follow and identity events owned by the count projection.
    }
  } finally {
    await worker.close();
  }
}

function writeHeaders(cookie: string, key: string, expectedRevision: number) {
  return {
    cookie,
    "idempotency-key": key,
    "if-match": `"${expectedRevision}"`,
  };
}
