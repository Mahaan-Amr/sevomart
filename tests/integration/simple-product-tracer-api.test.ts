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
    const mediaId = await uploadProductImage(server, cookie);

    const createKey = crypto.randomUUID();
    const created = await server.inject({
      method: "POST",
      url: "/v1/seller/products",
      headers: writeHeaders(cookie, createKey, 0),
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const emptyDraft = created.json<{ productId: string }>();

    const saved = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${emptyDraft.productId}/working-copy`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 0),
      payload: {
        expectedRevision: 0,
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
      headers: writeHeaders(cookie, publishKey, 1),
      payload: { expectedRevision: 1, confirmed: true },
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

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      const events = await sql<Array<{ count: number }>>`
        select count(*)::int as count from platform_outbox_events
        where event_type = 'ProductPublished.v1'
          and aggregate_id = ${emptyDraft.productId}::uuid
      `;
      expect(events[0]?.count).toBe(1);
    } finally {
      await sql.end();
    }
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

async function uploadProductImage(server: TestServer, cookie: string) {
  const source = await sharp({
    create: { width: 800, height: 800, channels: 4, background: "#A41439" },
  })
    .png()
    .toBuffer();
  const boundary = "product-image-boundary";
  const upload = await server.inject({
    method: "POST",
    url: "/v1/seller/media",
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
