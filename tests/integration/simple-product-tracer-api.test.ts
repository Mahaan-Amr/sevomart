import {
  publicSimpleProductContract,
  simpleProductDraftContract,
  simpleProductPreviewContract,
} from "@sevo/contracts/product/v1";
import postgres from "postgres";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("simple product tracer HTTP API", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`update identity_seller_access set status = 'ACTIVE'`;
    await sql`delete from store_idempotency_records`;
    await sql`delete from store_stores`;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("creates, previews and atomically publishes one sellable physical product", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const cookie = await signIn(server);
    await publishStore(server, cookie);

    const createKey = crypto.randomUUID();
    const created = await server.inject({
      method: "POST",
      url: "/v1/seller/products",
      headers: { cookie, "idempotency-key": createKey },
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const emptyDraft = created.json<{ productId: string }>();
    const mediaId = await uploadProductImage(server, cookie, emptyDraft.productId);

    const partial = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${emptyDraft.productId}/working-copy`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 0),
      payload: {
        expectedRevision: 0,
        workingCopy: {
          name: "فنجان سرامیکی",
          description: "فنجان دست‌ساز مناسب نوشیدنی گرم",
          orderedMediaIds: [],
          variant: { clientKey: "simple", price: null },
        },
        inventory: null,
      },
    });
    expect(partial.statusCode).toBe(200);

    const partialPreview = await server.inject({
      method: "GET",
      url: `/v1/seller/products/${emptyDraft.productId}/preview`,
      headers: { cookie },
    });
    expect(simpleProductPreviewContract.parse(partialPreview.json())).toMatchObject({
      ready: false,
      issues: expect.arrayContaining([{ path: "image", code: "REQUIRED" }]),
    });

    const saved = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${emptyDraft.productId}/working-copy`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 1),
      payload: {
        expectedRevision: 1,
        workingCopy: {
          name: "فنجان سرامیکی",
          description: "فنجان دست‌ساز مناسب نوشیدنی گرم",
          orderedMediaIds: [mediaId],
          variant: {
            clientKey: "simple",
            price: { amount: 4_500_000, currency: "IRR" },
          },
        },
        inventory: { onHand: 8, expectedRevision: 0 },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(simpleProductDraftContract.safeParse(saved.json()).success).toBe(true);

    const cleared = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${emptyDraft.productId}/working-copy`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 2),
      payload: {
        expectedRevision: 2,
        workingCopy: {
          name: "فنجان سرامیکی",
          description: "فنجان دست‌ساز مناسب نوشیدنی گرم",
          orderedMediaIds: [mediaId],
          variant: { clientKey: "simple", price: null },
        },
        inventory: null,
      },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().workingCopy.variant.price).toBeNull();

    const clearedPreview = await server.inject({
      method: "GET",
      url: `/v1/seller/products/${emptyDraft.productId}/preview`,
      headers: { cookie },
    });
    expect(simpleProductPreviewContract.parse(clearedPreview.json())).toMatchObject({
      ready: false,
      issues: expect.arrayContaining([{ path: "price", code: "REQUIRED" }]),
    });

    const restored = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${emptyDraft.productId}/working-copy`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 3),
      payload: {
        expectedRevision: 3,
        workingCopy: {
          name: "فنجان سرامیکی",
          description: "فنجان دست‌ساز مناسب نوشیدنی گرم",
          orderedMediaIds: [mediaId],
          variant: {
            clientKey: "simple",
            price: { amount: 4_500_000, currency: "IRR" },
          },
        },
        inventory: null,
      },
    });
    expect(restored.statusCode).toBe(200);

    const preview = await server.inject({
      method: "GET",
      url: `/v1/seller/products/${emptyDraft.productId}/preview`,
      headers: { cookie },
    });
    expect(preview.statusCode).toBe(200);
    expect(simpleProductPreviewContract.parse(preview.json())).toMatchObject({
      ready: true,
      issues: [],
    });

    const publishKey = crypto.randomUUID();
    const publicationRequest = {
      method: "POST" as const,
      url: `/v1/seller/products/${emptyDraft.productId}/publications`,
      headers: writeHeaders(cookie, publishKey, 4),
      payload: { expectedRevision: 4, confirmed: true },
    };
    const published = await server.inject(publicationRequest);
    expect(published.statusCode).toBe(200);
    const publicProduct = publicSimpleProductContract.parse(published.json());
    expect(publicProduct).toMatchObject({
      availability: "AVAILABLE",
      publicationVersion: 1,
    });

    const replayed = await server.inject(publicationRequest);
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual(published.json());

    const guestRead = await server.inject({
      method: "GET",
      url: `/v1/stores/product-tracer-store/products/${emptyDraft.productId}`,
    });
    expect(guestRead.statusCode).toBe(200);
    expect(guestRead.json()).toEqual(published.json());
    expect(JSON.stringify(guestRead.json())).not.toMatch(/onHand|sku/i);

    const guestList = await server.inject({
      method: "GET",
      url: "/v1/stores/product-tracer-store/products",
    });
    expect(guestList.statusCode).toBe(200);
    expect(guestList.json().products[0]).not.toHaveProperty("description");

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      const events = await sql<Array<{ count: number }>>`
        select count(*)::int as count from platform_outbox_events
        where event_type = 'ProductPublished.v1'
          and aggregate_id = ${emptyDraft.productId}::uuid
      `;
      expect(events[0]?.count).toBe(1);
      const adjustments = await sql<
        Array<{ reasonCode: string; previousOnHand: number; nextOnHand: number }>
      >`
        select reason_code as "reasonCode", previous_on_hand as "previousOnHand",
          next_on_hand as "nextOnHand"
        from inventory_adjustments
        where variant_id = ${saved.json().workingCopy.variant.variantId}::uuid
      `;
      expect(adjustments).toEqual([
        { reasonCode: "INITIAL_STOCK", previousOnHand: 0, nextOnHand: 8 },
      ]);
    } finally {
      await sql.end();
    }
  });

  it("rejects private product preview when seller access is no longer active", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const cookie = await signIn(server);
    await publishStore(server, cookie);
    const created = await server.inject({
      method: "POST",
      url: "/v1/seller/products",
      headers: { cookie, "idempotency-key": crypto.randomUUID() },
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const productId = created.json<{ productId: string }>().productId;
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql`update identity_seller_access set status = 'SUSPENDED'`;
    } finally {
      await sql.end();
    }

    const response = await server.inject({
      method: "GET",
      url: `/v1/seller/products/${productId}/preview`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
  });
});

type TestServer =
  Awaited<ReturnType<typeof createApiApp>> extends infer T
    ? T extends { getHttpAdapter(): { getInstance(): infer S } }
      ? S
      : never
    : never;

async function signIn(server: TestServer) {
  const requested = await server.inject({
    method: "POST",
    url: "/v1/auth/otp/requests",
    payload: { mobile: "09123456789" },
  });
  const verified = await server.inject({
    method: "POST",
    url: "/v1/auth/otp/verifications",
    payload: {
      challengeId: requested.json<{ challengeId: string }>().challengeId,
      code: "111111",
    },
  });
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  try {
    await sql`
      insert into identity_seller_access (id, identity_id, status)
      select ${crypto.randomUUID()}::uuid, identity_id, 'ACTIVE'
      from identity_login_methods where mobile = '09123456789'
      on conflict (identity_id) do update set status = 'ACTIVE'
    `;
  } finally {
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
      name: "خانه کالای ساده",
      slug: "product-tracer-store",
      bio: "فروشگاه آزمایشی برای کالای فیزیکی",
      shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
      returnPolicy: "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.",
      settlementDestination: { kind: "TEST" },
      logoMediaId: null,
      coverMediaId: null,
      themeColor: "#A41439",
    },
  });
  expect(saved.statusCode).toBe(200);
  const published = await server.inject({
    method: "POST",
    url: "/v1/seller/store/publication",
    headers: writeHeaders(cookie, crypto.randomUUID(), 1),
  });
  expect(published.statusCode).toBe(200);
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
  const boundary = "product-image-boundary";
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
  expect(upload.statusCode).toBe(201);
  return upload.json<{ id: string }>().id;
}

function writeHeaders(cookie: string, key: string, expectedRevision: number) {
  return {
    cookie,
    "idempotency-key": key,
    "if-match": `"${expectedRevision}"`,
  };
}
