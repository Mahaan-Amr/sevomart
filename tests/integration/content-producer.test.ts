import { createHash, randomUUID } from "node:crypto";

import {
  publishPurchaseExperienceInputContract,
  publishSalesContentInputContract,
} from "@sevo/contracts/content/v1";
import { orderItemIdContract } from "@sevo/contracts/orders/v1";
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
import {
  createContentMediaRead,
  PostgresContentRepository,
} from "../../apps/api/src/modules/content/composition";
import { createActiveSellerFixture } from "../../apps/api/src/modules/identity-access/testing/active-seller.fixture";
import {
  MEDIA_STORAGE,
  type MediaStorage,
} from "../../apps/api/src/modules/media/public";
import { createPaidOrderItemFixture } from "../../apps/api/src/modules/orders/testing/paid-order-item.fixture";
import { createPublishedProductFixture } from "../../apps/api/src/modules/product/testing/published-product.fixture";
import { createOwnedSellableStoreFixture } from "../../apps/api/src/modules/store/testing/owned-sellable-store.fixture";
import { projectContentProductState } from "../../apps/worker/src/modules/content/index";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 2 });
const repository = new PostgresContentRepository(apiTestEnvironment.DATABASE_URL);
const actorId = identityIdContract.parse("10000000-0000-4000-8000-000000000091");
const storeId = storeIdContract.parse("20000000-0000-4000-8000-000000000091");
const productId = productIdContract.parse("30000000-0000-4000-8000-000000000091");
const contentSellerMobile = "09120000139";
const contentSellerEnvironment = {
  ...apiTestEnvironment,
  DEV_OTP_TEST_MOBILES: [
    contentSellerMobile,
  ] as typeof apiTestEnvironment.DEV_OTP_TEST_MOBILES,
};

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
    const attachmentId = "40000000-0000-4000-8000-000000000092";
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
      await storage.put({
        key: attachmentId,
        purpose: "CONVERSATION_ATTACHMENT",
        contentType: "image/png",
        bytes: Uint8Array.from([1]),
        checksum: "b".repeat(64),
        width: 1,
        height: 1,
        variants: [
          {
            key: `media/${attachmentId}/variants/attachment-preview.webp`,
            name: "attachment-preview",
            contentType: "image/webp",
            bytes: Uint8Array.from([2]),
            width: 1,
            height: 1,
          },
        ],
        ownerSellerId: actorId,
        ownerReferenceId: randomUUID(),
        visibility: "PRIVATE",
      });
      await expect(
        createContentMediaRead(storage).readOwnedKind(attachmentId, actorId),
      ).resolves.toBeUndefined();
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
      for (const url of ["/v1/seller/sales-content", "/v1/purchase-experiences"]) {
        const compatibilityResponse = await server.inject({
          method: "POST",
          url,
          payload: {},
        });
        expect(compatibilityResponse.statusCode).toBe(404);
      }

      const unauthenticated = await server.inject({
        method: "POST",
        url: "/v2/seller/sales-content",
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
        url: "/v2/purchase-experiences",
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

  it("publishes sales content through the authenticated v2 HTTP surface", async () => {
    const app = await createApiApp(contentSellerEnvironment);
    const server = app.getHttpAdapter().getInstance();
    const storage = app.get<MediaStorage>(MEDIA_STORAGE);
    const fixtureStoreId = storeIdContract.parse(randomUUID());
    const fixtureProductId = productIdContract.parse(randomUUID());
    const fixtureVariantId = randomUUID();
    const fixtureMediaId = randomUUID();
    let sellerId = "";
    let contentId = "";
    let activeSeller: Awaited<ReturnType<typeof createActiveSellerFixture>> | undefined;
    let ownedStore:
      Awaited<ReturnType<typeof createOwnedSellableStoreFixture>> | undefined;
    let publishedProduct:
      Awaited<ReturnType<typeof createPublishedProductFixture>> | undefined;
    try {
      const requested = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: contentSellerMobile },
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
      sellerId = session.json().actor.identityId;
      const parsedSellerId = identityIdContract.parse(sellerId);
      activeSeller = await createActiveSellerFixture(
        apiTestEnvironment.DATABASE_URL,
        parsedSellerId,
      );
      ownedStore = await createOwnedSellableStoreFixture(
        apiTestEnvironment.DATABASE_URL,
        { sellerId: parsedSellerId, storeId: fixtureStoreId },
      );
      publishedProduct = await createPublishedProductFixture(
        apiTestEnvironment.DATABASE_URL,
        {
          productId: fixtureProductId,
          storeId: fixtureStoreId,
          mediaId: fixtureMediaId,
          variantId: fixtureVariantId,
        },
      );
      await storage.put({
        key: fixtureMediaId,
        purpose: "PRODUCT_IMAGE",
        contentType: "image/png",
        bytes: Uint8Array.from([1]),
        checksum: "c".repeat(64),
        width: 1,
        height: 1,
        variants: [],
        ownerSellerId: parsedSellerId,
        visibility: "PRIVATE",
      });

      const published = await server.inject({
        method: "POST",
        url: "/v2/seller/sales-content",
        headers: { cookie, "idempotency-key": "sales-content-http-v2-139" },
        payload: {
          storeId: fixtureStoreId,
          media: { mediaId: fixtureMediaId, kind: "IMAGE" },
          productIds: [fixtureProductId],
        },
      });
      expect(published.statusCode).toBe(201);
      expect(published.json()).toMatchObject({
        source: "SELLER",
        moderationState: "PUBLISHED",
      });
      contentId = published.json().contentId;
      expect(contentId).toEqual(expect.any(String));
      expect(
        await sql`
          select product_id as "productId", publication_version as "publicationVersion"
          from content_sales_content_products
          where content_id = ${contentId}
        `,
      ).toEqual([{ productId: fixtureProductId, publicationVersion: 1 }]);
    } finally {
      if (contentId) {
        await sql`delete from platform_outbox_events where aggregate_id = ${contentId}`;
        await sql`delete from content_audits where aggregate_id = ${contentId}`;
      }
      if (sellerId) {
        await sql`delete from content_idempotency_records where actor_id = ${sellerId}`;
        await sql`delete from content_sales_content_products where content_id in (select id from content_sales_contents where actor_identity_id = ${sellerId})`;
        await sql`delete from content_sales_contents where actor_identity_id = ${sellerId}`;
      }
      await publishedProduct?.cleanup();
      await ownedStore?.cleanup();
      await activeSeller?.cleanup();
      await app.close();
    }
  });

  it("publishes one purchase experience through HTTP for the buyer's paid order item", async () => {
    const app = await createApiApp(apiTestEnvironment);
    const server = app.getHttpAdapter().getInstance();
    const storage = app.get<MediaStorage>(MEDIA_STORAGE);
    const orderItemId = orderItemIdContract.parse(
      "94000000-0000-4000-8000-000000000091",
    );
    let buyerId = "";
    let experienceId = "";
    let paidOrder: Awaited<ReturnType<typeof createPaidOrderItemFixture>> | undefined;
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
      paidOrder = await createPaidOrderItemFixture(apiTestEnvironment.DATABASE_URL, {
        buyerId: identityIdContract.parse(buyerId),
        storeId,
        productId,
        orderItemId,
      });
      const eligibility = await server.inject({
        method: "GET",
        url: `/v2/purchase-experiences/eligibility/${orderItemId}`,
        headers: { cookie },
      });
      expect(eligibility.statusCode).toBe(200);
      expect(eligibility.json()).toMatchObject({
        eligible: true,
        buyerId,
        orderItemId,
        storeId,
        productId,
      });
      const mediaId = randomUUID();
      await storage.put({
        key: mediaId,
        purpose: "PRODUCT_IMAGE",
        contentType: "image/png",
        bytes: Uint8Array.from([1]),
        checksum: "d".repeat(64),
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
        ownerSellerId: buyerId,
        visibility: "PRIVATE",
      });
      const payload = {
        buyerId,
        orderItemId,
        rating: 5,
        text: "کالا سالم و مطابق تصویر رسید.",
        mediaIds: [mediaId],
      };
      const published = await server.inject({
        method: "POST",
        url: "/v2/purchase-experiences",
        headers: { cookie, "idempotency-key": "experience-http-91" },
        payload,
      });
      expect(published.statusCode).toBe(201);
      experienceId = published.json().experienceId;

      const publicFeed = await server.inject({
        method: "GET",
        url: `/v2/products/${productId}/purchase-experiences`,
      });
      expect(publicFeed.statusCode).toBe(200);
      expect(publicFeed.json()).toEqual({
        productId,
        summary: { verifiedPurchaseCount: 1, averageRating: null },
        experiences: [
          expect.objectContaining({
            experienceId,
            source: "VERIFIED_PURCHASE",
            moderationState: "PUBLISHED",
            rating: 5,
            text: payload.text,
            mediaIds: [mediaId],
          }),
        ],
      });
      await sql`
        insert into content_purchase_experiences
          (id, buyer_identity_id, order_item_id, store_id, product_id,
           moderation_state, rating, text, media_ids)
        values
          (${randomUUID()}, ${buyerId}, ${randomUUID()}, ${storeId}, ${productId},
           'PUBLISHED', 4, 'تجربه منتشرشده دوم', '{}'),
          (${randomUUID()}, ${buyerId}, ${randomUUID()}, ${storeId}, ${productId},
           'PUBLISHED', 3, 'تجربه منتشرشده سوم', '{}'),
          (${randomUUID()}, ${buyerId}, ${randomUUID()}, ${storeId}, ${productId},
           'HIDDEN', 1, 'این تجربه نباید عمومی باشد', '{}')
      `;
      const thresholdFeed = await server.inject({
        method: "GET",
        url: `/v2/products/${productId}/purchase-experiences`,
      });
      expect(thresholdFeed.statusCode).toBe(200);
      expect(thresholdFeed.json()).toMatchObject({
        summary: { verifiedPurchaseCount: 3, averageRating: 4 },
      });
      expect(thresholdFeed.json().experiences).toHaveLength(3);
      expect(thresholdFeed.json().experiences).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: "این تجربه نباید عمومی باشد" }),
        ]),
      );
      const publicMedia = await server.inject({
        method: "GET",
        url: `/v1/media/${mediaId}`,
      });
      expect(publicMedia.statusCode).toBe(200);

      const submittedEligibility = await server.inject({
        method: "GET",
        url: `/v2/purchase-experiences/eligibility/${orderItemId}`,
        headers: { cookie },
      });
      expect(submittedEligibility.statusCode).toBe(200);
      expect(submittedEligibility.json()).toEqual({
        eligible: false,
        reason: "ALREADY_SUBMITTED",
      });

      const duplicate = await server.inject({
        method: "POST",
        url: "/v2/purchase-experiences",
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
      await paidOrder?.cleanup();
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
