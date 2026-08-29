import { createHash, randomUUID } from "node:crypto";

import {
  publishPurchaseExperienceInputContract,
  publishSalesContentInputContract,
} from "@sevo/contracts/content/v1";
import {
  identityIdContract,
  productIdContract,
  storeIdContract,
} from "@sevo/contracts/platform/v1";
import {
  productPublishedV1Contract,
  productUnpublishedV1Contract,
} from "@sevo/contracts/product/v1";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { PostgresContentRepository } from "../../apps/api/src/modules/content/composition";
import {
  MEDIA_STORAGE,
  type MediaStorage,
} from "../../apps/api/src/modules/media/public";
import { projectContentProductState } from "../../apps/worker/src/modules/content/index";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 2 });
const repository = new PostgresContentRepository(apiTestEnvironment.DATABASE_URL);
const actorId = identityIdContract.parse("10000000-0000-4000-8000-000000000091");
const storeId = storeIdContract.parse("20000000-0000-4000-8000-000000000091");
const productId = productIdContract.parse("30000000-0000-4000-8000-000000000091");

beforeEach(async () => {
  await sql`delete from content_product_states where product_id = ${productId}`;
  await sql`delete from content_idempotency_records where actor_id = ${actorId}`;
  await sql`delete from content_audits where actor_identity_id = ${actorId}`;
  await sql`delete from content_sales_content_products where content_id in (select id from content_sales_contents where actor_identity_id = ${actorId})`;
  await sql`delete from content_sales_contents where actor_identity_id = ${actorId}`;
  await sql`delete from content_purchase_experiences where buyer_identity_id = ${actorId}`;
});

afterAll(async () => {
  await repository.onModuleDestroy();
  await sql.end();
});

describe("content producer persistence", () => {
  it("serves media referenced by active published content to an anonymous reader", async () => {
    const app = await createApiApp(apiTestEnvironment);
    const server = app.getHttpAdapter().getInstance();
    const storage = app.get<MediaStorage>(MEDIA_STORAGE);
    const mediaId = "40000000-0000-4000-8000-000000000091";
    try {
      await storage.put({
        key: mediaId,
        purpose: "PRODUCT_IMAGE",
        contentType: "image/png",
        bytes: Uint8Array.from([1]),
        checksum: "a".repeat(64),
        width: 1,
        height: 1,
        variants: [
          {
            key: `media/${mediaId}/variants/product-detail.webp`,
            name: "product-detail",
            contentType: "image/webp",
            bytes: Uint8Array.from([2]),
            width: 1,
            height: 1,
          },
        ],
        ownerSellerId: actorId,
        visibility: "PRIVATE",
      });
      const input = publishSalesContentInputContract.parse({
        storeId,
        media: { mediaId, kind: "IMAGE" },
        productIds: [productId],
      });
      await repository.publishSalesContent({
        actorId,
        correlationId: randomUUID(),
        idempotencyKey: "public-media-91",
        requestHash: digest(input),
        input,
        products: [{ productId, publicationVersion: 1 }],
      });

      const read = await server.inject({ method: "GET", url: `/v1/media/${mediaId}` });
      expect(read.statusCode).toBe(200);
      expect(read.headers["cache-control"]).toBeUndefined();

      const correlationId = randomUUID();
      await sql.begin((transaction) =>
        projectContentProductState(
          productUnpublishedV1Contract.parse({
            version: 1,
            eventId: randomUUID(),
            eventType: "ProductUnpublished.v1",
            aggregateId: productId,
            aggregateVersion: 2,
            occurredAt: new Date().toISOString(),
            correlationId,
            causationId: correlationId,
            actor: { type: "IDENTITY", id: actorId },
            payload: { storeId, productId, publicationVersion: 1 },
          }),
          transaction,
        ),
      );
      const stoppedRead = await server.inject({
        method: "GET",
        url: `/v1/media/${mediaId}`,
      });
      expect(stoppedRead.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("composes both HTTP operations and fails closed at authentication and preconditions", async () => {
    const app = await createApiApp(apiTestEnvironment);
    const server = app.getHttpAdapter().getInstance();
    try {
      const unauthenticated = await server.inject({
        method: "POST",
        url: "/v1/seller/sales-content",
        payload: {},
      });
      expect(unauthenticated.statusCode).toBe(401);

      const requested = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: "09123456789" },
      });
      const verified = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: requested.json().challengeId, code: "111111" },
      });
      const cookie = verified.headers["set-cookie"]!;
      const session = await server.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie },
      });
      const missingPrecondition = await server.inject({
        method: "POST",
        url: "/v1/purchase-experiences",
        headers: { cookie },
        payload: {
          buyerId: session.json().actor.identityId,
          orderItemId: randomUUID(),
          rating: 5,
          text: "خوب بود.",
          mediaIds: [],
        },
      });
      expect(missingPrecondition.statusCode).toBe(428);
      expect(missingPrecondition.json().code).toBe("PRECONDITION_REQUIRED");
    } finally {
      await app.close();
    }
  });

  it("publishes one purchase experience through HTTP for the buyer's paid order item", async () => {
    const app = await createApiApp(apiTestEnvironment);
    const server = app.getHttpAdapter().getInstance();
    const cartId = "91000000-0000-4000-8000-000000000091";
    const checkoutId = "92000000-0000-4000-8000-000000000091";
    const orderId = "93000000-0000-4000-8000-000000000091";
    const orderItemId = "94000000-0000-4000-8000-000000000091";
    const variantId = "95000000-0000-4000-8000-000000000091";
    let buyerId = "";
    let experienceId = "";
    try {
      const requested = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: "09123456789" },
      });
      expect(requested.statusCode).toBe(202);
      const verified = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: requested.json().challengeId, code: "111111" },
      });
      expect(verified.statusCode).toBe(200);
      const cookie = verified.headers["set-cookie"]!;
      const session = await server.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie },
      });
      buyerId = session.json().actor.identityId;
      await sql`
        insert into order_carts
          (id, store_id, identity_id, status, revision, expires_at)
        values (${cartId}, ${storeId}, ${buyerId}, 'CONVERTED', 1,
          now() + interval '1 day')
      `;
      await sql`
        insert into order_checkout_preparations
          (checkout_revision, identity_id, cart_id, cart_revision,
           shipping_method_id, shipping_revision, policy_revision, snapshot, expires_at)
        values (${checkoutId}, ${buyerId}, ${cartId}, 1,
          '96000000-0000-4000-8000-000000000091', 1, 1, ${sql.json({})},
          now() + interval '1 day')
      `;
      await sql`
        insert into order_orders
          (id, identity_id, store_id, checkout_revision, reservation_id, status,
           total_amount, currency, reservation_expires_at, review_snapshot, paid_at)
        values (${orderId}, ${buyerId}, ${storeId}, ${checkoutId},
          '97000000-0000-4000-8000-000000000091', 'PAID', 1000, 'IRR',
          now() + interval '1 day', ${sql.json({})}, now())
      `;
      await sql`
        insert into order_items
          (id, order_id, variant_id, product_id, name, quantity,
           unit_price_amount, publication_version)
        values (${orderItemId}, ${orderId}, ${variantId}, ${productId},
          'کالای تأییدشده', 1, 1000, 1)
      `;
      const payload = {
        buyerId,
        orderItemId,
        rating: 5,
        text: "کالا سالم و مطابق تصویر رسید.",
        mediaIds: [],
      };
      const published = await server.inject({
        method: "POST",
        url: "/v1/purchase-experiences",
        headers: { cookie, "idempotency-key": "experience-http-91" },
        payload,
      });
      expect(published.statusCode).toBe(201);
      experienceId = published.json().experienceId;

      const duplicate = await server.inject({
        method: "POST",
        url: "/v1/purchase-experiences",
        headers: { cookie, "idempotency-key": "experience-http-91-duplicate" },
        payload,
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().code).toBe("ALREADY_SUBMITTED");
    } finally {
      if (experienceId) {
        await sql`delete from platform_outbox_events where aggregate_id = ${experienceId}`;
        await sql`delete from content_audits where aggregate_id = ${experienceId}`;
      }
      if (buyerId) {
        await sql`delete from content_idempotency_records where actor_id = ${buyerId}`;
        await sql`delete from content_purchase_experiences where buyer_identity_id = ${buyerId}`;
      }
      await sql`delete from order_items where order_id = ${orderId}`;
      await sql`delete from order_orders where id = ${orderId}`;
      await sql`delete from order_checkout_preparations where checkout_revision = ${checkoutId}`;
      await sql`delete from order_carts where id = ${cartId}`;
      await app.close();
    }
  });

  it("atomically publishes and replays seller content, then deactivates it on product stop", async () => {
    const input = publishSalesContentInputContract.parse({
      storeId,
      media: { mediaId: "40000000-0000-4000-8000-000000000091", kind: "IMAGE" },
      productIds: [productId],
    });
    const correlationId = randomUUID();
    const command = {
      actorId,
      correlationId,
      idempotencyKey: "sales-91",
      requestHash: digest(input),
      input,
      products: [{ productId, publicationVersion: 4 }],
    };
    const published = await repository.publishSalesContent(command);
    expect(await repository.replaySalesContent(command)).toEqual(published);
    expect(await repository.publishSalesContent(command)).toEqual(published);
    expect(
      await sql`select id, active from content_sales_contents where id = ${published.contentId}`,
    ).toMatchObject([{ id: published.contentId, active: true }]);
    expect(
      await sql`select event_type from platform_outbox_events where aggregate_id = ${published.contentId}`,
    ).toEqual([{ event_type: "SalesContentPublished.v1" }]);

    const stopped = productUnpublishedV1Contract.parse({
      version: 1,
      eventId: randomUUID(),
      eventType: "ProductUnpublished.v1",
      aggregateId: productId,
      aggregateVersion: 8,
      occurredAt: new Date().toISOString(),
      correlationId,
      causationId: correlationId,
      actor: { type: "IDENTITY", id: actorId },
      payload: { storeId, productId, publicationVersion: 4 },
    });
    await sql.begin((transaction) => projectContentProductState(stopped, transaction));
    expect(
      await sql`
        select active, publication_version as "publicationVersion"
        from content_sales_content_products
        where content_id = ${published.contentId}
      `,
    ).toEqual([{ active: false, publicationVersion: 4 }]);

    const stalePublication = productPublishedV1Contract.parse({
      version: 1,
      eventId: randomUUID(),
      eventType: "ProductPublished.v1",
      aggregateId: productId,
      aggregateVersion: 7,
      occurredAt: new Date().toISOString(),
      correlationId,
      causationId: correlationId,
      actor: { type: "IDENTITY", id: actorId },
      payload: {
        storeId,
        productId,
        publicationVersion: 4,
        snapshot: {
          productId,
          name: "کالای قدیمی",
          image: {
            id: "40000000-0000-4000-8000-000000000091",
            url: "/v1/media/40000000-0000-4000-8000-000000000091",
          },
          price: { amount: 1000, currency: "IRR" },
          availability: "AVAILABLE",
          publicationVersion: 4,
        },
        offerVersion: 4,
        availabilityVersion: 4,
      },
    });
    await sql.begin((transaction) =>
      projectContentProductState(stalePublication, transaction),
    );
    expect(
      await sql`select active from content_sales_contents where id = ${published.contentId}`,
    ).toEqual([{ active: false }]);
  });

  it("rejects publication when a same-version stop was projected after the read", async () => {
    const input = publishSalesContentInputContract.parse({
      storeId,
      media: { mediaId: "40000000-0000-4000-8000-000000000091", kind: "IMAGE" },
      productIds: [productId],
    });
    const correlationId = randomUUID();
    const stopped = productUnpublishedV1Contract.parse({
      version: 1,
      eventId: randomUUID(),
      eventType: "ProductUnpublished.v1",
      aggregateId: productId,
      aggregateVersion: 8,
      occurredAt: new Date().toISOString(),
      correlationId,
      causationId: correlationId,
      actor: { type: "IDENTITY", id: actorId },
      payload: { storeId, productId, publicationVersion: 4 },
    });
    await sql.begin((transaction) => projectContentProductState(stopped, transaction));

    await expect(
      repository.publishSalesContent({
        actorId,
        correlationId,
        idempotencyKey: "sales-stopped-91",
        requestHash: digest(input),
        input,
        products: [{ productId, publicationVersion: 4 }],
      }),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_PRODUCT" });
  });

  it("publishes one private-linked purchase experience and emits a PII-minimal event", async () => {
    const input = publishPurchaseExperienceInputContract.parse({
      buyerId: actorId,
      orderItemId: "50000000-0000-4000-8000-000000000091",
      rating: 5,
      text: "کالا سالم و مطابق تصویر رسید.",
      mediaIds: [],
    });
    const command = {
      actorId,
      correlationId: randomUUID(),
      idempotencyKey: "experience-91",
      requestHash: digest(input),
      input,
      storeId,
      productId,
    };
    const published = await repository.publishPurchaseExperience(command);
    expect(await repository.replayPurchaseExperience(command)).toEqual(published);
    await expect(
      repository.publishPurchaseExperience({
        ...command,
        idempotencyKey: "experience-91-second-key",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_SUBMITTED" });
    const [event] = await sql<Array<{ payload: Record<string, unknown> }>>`
      select payload from platform_outbox_events
      where aggregate_id = ${published.experienceId}
    `;
    expect(event?.payload).toMatchObject({
      source: "VERIFIED_PURCHASE",
      storeId,
      productId,
    });
    expect(event?.payload).not.toHaveProperty("buyerId");
    expect(event?.payload).not.toHaveProperty("orderItemId");
  });
});

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
