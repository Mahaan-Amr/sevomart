import {
  productPreviewContract,
  productAuthoritativeVariantV1Contract,
  productPublishedV2Contract,
  productUnpublishedV1Contract,
  variantPriceChangedV1Contract,
  productViewContract,
  publicProductContract,
  publicSimpleProductContract,
  simpleProductDraftContract,
  simpleProductPreviewContract,
} from "@sevo/contracts/product/v1";
import postgres from "postgres";
import { variantAvailabilityChangedV1Contract } from "@sevo/contracts/inventory/v1";
import { replayOutboxEventHistory } from "@sevo/outbox";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { PostgresInventoryAuthoring } from "../../apps/api/src/modules/inventory/composition";
import {
  createOpaqueProductTransactionContext,
  PostgresProductRepository,
} from "../../apps/api/src/modules/product/composition";
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

  async function startSellerProductTest() {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const cookie = await signIn(server);
    await publishStore(server, cookie);
    return { server, cookie };
  }

  it("creates, previews and atomically publishes one sellable physical product", async () => {
    const { server, cookie } = await startSellerProductTest();

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
    expect(await simpleVariantState(emptyDraft.productId)).toEqual([
      { clientKey: "simple", everPublished: false },
    ]);

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
    expect(await simpleVariantState(emptyDraft.productId)).toEqual([
      { clientKey: "simple", everPublished: true },
    ]);

    const sellerInventory = await server.inject({
      method: "GET",
      url: "/v1/seller/inventory?limit=20&availability=AVAILABLE",
      headers: { cookie },
    });
    expect(sellerInventory.statusCode).toBe(200);
    expect(sellerInventory.json()).toMatchObject({
      items: [
        expect.objectContaining({
          productId: emptyDraft.productId,
          variantId: publicProduct.variantId,
          productName: "فنجان سرامیکی",
          onHand: 8,
          available: 8,
          revision: 1,
        }),
      ],
    });

    const adjust = async (
      key: string,
      reasonCode: "MANUAL_COUNT" | "DAMAGED" | "CORRECTION",
      onHand: number,
      expectedRevision: number,
    ) =>
      server.inject({
        method: "PUT",
        url: "/v1/seller/inventory",
        headers: { cookie, "idempotency-key": key },
        payload: {
          reasonCode,
          note: "شمارش ممیزی‌شده انبار",
          rows: [{ variantId: publicProduct.variantId, onHand, expectedRevision }],
        },
      });
    const increaseKey = crypto.randomUUID();
    const invalid = await server.inject({
      method: "PUT",
      url: "/v1/seller/inventory",
      headers: { cookie, "idempotency-key": crypto.randomUUID() },
      payload: {
        reasonCode: "MANUAL_COUNT",
        rows: [
          {
            variantId: publicProduct.variantId,
            onHand: -1,
            expectedRevision: 1,
          },
        ],
      },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toEqual({
      version: 1,
      code: "VALIDATION_ERROR",
      message: "اطلاعات موجودی را بررسی کنید.",
      correlationId: expect.any(String),
      details: {
        issues: [
          {
            path: "rows.0.onHand",
            code: "INVALID_FORMAT",
            variantId: publicProduct.variantId,
          },
        ],
      },
    });
    const duplicateRows = await server.inject({
      method: "PUT",
      url: "/v1/seller/inventory",
      headers: { cookie, "idempotency-key": crypto.randomUUID() },
      payload: {
        reasonCode: "MANUAL_COUNT",
        rows: [
          { variantId: publicProduct.variantId, onHand: 8, expectedRevision: 1 },
          { variantId: publicProduct.variantId, onHand: 8, expectedRevision: 1 },
        ],
      },
    });
    expect(duplicateRows.statusCode).toBe(422);
    expect(duplicateRows.json().details.issues).toEqual([
      {
        path: "rows.0.variantId",
        code: "DUPLICATE",
        variantId: publicProduct.variantId,
      },
      {
        path: "rows.1.variantId",
        code: "DUPLICATE",
        variantId: publicProduct.variantId,
      },
    ]);
    const increased = await adjust(increaseKey, "MANUAL_COUNT", 9, 1);
    expect(increased.statusCode).toBe(200);
    expect(increased.json()).toMatchObject({
      rows: [{ onHand: 9, revision: 2, availability: "AVAILABLE" }],
    });
    const replayedIncrease = await adjust(increaseKey, "MANUAL_COUNT", 9, 1);
    expect(replayedIncrease.json()).toEqual(increased.json());
    expect((await adjust(increaseKey, "MANUAL_COUNT", 10, 2)).statusCode).toBe(409);
    expect((await adjust(crypto.randomUUID(), "DAMAGED", 7, 2)).statusCode).toBe(200);
    expect((await adjust(crypto.randomUUID(), "CORRECTION", 8, 3)).statusCode).toBe(
      200,
    );

    const auditSql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const adjustments = await auditSql<
      Array<{
        previousOnHand: number;
        nextOnHand: number;
        reasonCode: string;
        operation: string;
        previousRevision: number;
        nextRevision: number;
        actorIdentityId: string;
        note: string | null;
        occurredAt: Date;
      }>
    >`
      select previous_on_hand as "previousOnHand", next_on_hand as "nextOnHand",
        reason_code as "reasonCode", operation,
        previous_revision as "previousRevision", next_revision as "nextRevision",
        actor_identity_id as "actorIdentityId", note,
        occurred_at as "occurredAt"
      from inventory_adjustments
      where variant_id = ${publicProduct.variantId}::uuid
      order by revision
    `;
    await auditSql.end();
    expect(adjustments.slice(-3)).toEqual([
      expect.objectContaining({
        previousOnHand: 8,
        nextOnHand: 9,
        reasonCode: "MANUAL_COUNT",
        operation: "REPLACE_ON_HAND",
        previousRevision: 1,
        nextRevision: 2,
        note: "شمارش ممیزی‌شده انبار",
        occurredAt: expect.any(Date),
      }),
      expect.objectContaining({
        previousOnHand: 9,
        nextOnHand: 7,
        reasonCode: "DAMAGED",
      }),
      expect.objectContaining({
        previousOnHand: 7,
        nextOnHand: 8,
        reasonCode: "CORRECTION",
      }),
    ]);

    const reservationInventory = new PostgresInventoryAuthoring(
      apiTestEnvironment.DATABASE_URL,
    );
    const reservationSql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const reservationId = crypto.randomUUID();
    const [inventoryOwner] = await reservationSql<Array<{ storeId: string }>>`
      select store_id as "storeId" from inventory_levels
      where variant_id = ${publicProduct.variantId}::uuid
    `;
    await reservationSql.begin((transaction) =>
      reservationInventory.reserveForOrder(transaction as never, {
        reservationId,
        orderId: crypto.randomUUID(),
        storeId: inventoryOwner!.storeId as never,
        expiresAt: new Date(Date.now() + 60_000),
        items: [{ variantId: publicProduct.variantId, quantity: 8 }],
      }),
    );
    const reservedPublicRead = await server.inject({
      method: "GET",
      url: `/v1/stores/product-tracer-store/products/${emptyDraft.productId}`,
    });
    expect(reservedPublicRead.json()).toMatchObject({
      availability: "OUT_OF_STOCK",
    });
    expect(JSON.stringify(reservedPublicRead.json())).not.toMatch(
      /onHand|reserved|sku/i,
    );
    await reservationSql.begin((transaction) =>
      reservationInventory.releaseExpiredReservation(transaction as never, {
        reservationId,
        expiredAt: new Date(Date.now() + 120_000),
      }),
    );
    await reservationSql.end();
    await reservationInventory.onModuleDestroy();

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

    const unpublished = await server.inject({
      method: "POST",
      url: `/v1/seller/products/${emptyDraft.productId}/unpublication`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 5),
      payload: { expectedRevision: 5, reasonCode: "SELLER_REQUEST" },
    });
    expect(unpublished.statusCode).toBe(200);
    expect(unpublished.json()).toMatchObject({
      state: "UNPUBLISHED",
      revision: 6,
      publicationVersion: 1,
    });
    expect(
      (
        await server.inject({
          method: "GET",
          url: `/v1/stores/product-tracer-store/products/${emptyDraft.productId}`,
        })
      ).statusCode,
    ).toBe(404);
    const republished = await server.inject({
      method: "POST",
      url: `/v1/seller/products/${emptyDraft.productId}/publications`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 6),
      payload: { expectedRevision: 6, confirmed: true },
    });
    expect(republished.statusCode).toBe(200);
    expect(republished.json()).toMatchObject({ publicationVersion: 2 });

    const emptiedAfterRepublish = await adjust(crypto.randomUUID(), "CORRECTION", 0, 4);
    expect(emptiedAfterRepublish.statusCode).toBe(200);

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      const events = await sql<Array<{ count: number; hasCausation: boolean }>>`
        select count(*)::int as count,
          bool_and(causation_id is not null) as "hasCausation"
        from platform_outbox_events
        where event_type = 'ProductPublished.v2'
          and aggregate_id = ${emptyDraft.productId}::uuid
      `;
      expect(events).toEqual([{ count: 2, hasCausation: true }]);
      const availabilityEvents = await sql<
        Array<{ publicationVersion: number; availability: string }>
      >`
        select (payload->>'publicationVersion')::int as "publicationVersion",
          payload->>'availability' as availability
        from platform_outbox_events
        where event_type = 'VariantAvailabilityChanged.v1'
          and aggregate_id = ${publicProduct.variantId}::uuid
        order by aggregate_version desc
        limit 1
      `;
      expect(availabilityEvents).toEqual([
        { publicationVersion: 2, availability: "OUT_OF_STOCK" },
      ]);
      const unpublicationEvents = await sql<
        Array<{ count: number; hasCausation: boolean }>
      >`
        select count(*)::int as count,
          bool_and(causation_id is not null) as "hasCausation"
        from platform_outbox_events
        where event_type = 'ProductUnpublished.v1'
          and aggregate_id = ${emptyDraft.productId}::uuid
      `;
      expect(unpublicationEvents).toEqual([{ count: 1, hasCausation: true }]);
      const adjustments = await sql<
        Array<{ reasonCode: string; previousOnHand: number; nextOnHand: number }>
      >`
        select reason_code as "reasonCode", previous_on_hand as "previousOnHand",
          next_on_hand as "nextOnHand"
        from inventory_adjustments
        where variant_id = ${saved.json().workingCopy.variant.variantId}::uuid
      `;
      expect(adjustments).toContainEqual({
        reasonCode: "INITIAL_STOCK",
        previousOnHand: 0,
        nextOnHand: 8,
      });
    } finally {
      await sql.end();
    }
  });

  it("rejects private product preview when seller access is no longer active", async () => {
    const { server, cookie } = await startSellerProductTest();
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

  it("retires a published variant only when the edited working copy is published", async () => {
    const { server, cookie } = await startSellerProductTest();

    const created = await server.inject({
      method: "POST",
      url: "/v1/seller/products",
      headers: { cookie, "idempotency-key": crypto.randomUUID() },
      payload: {},
    });
    const productId = created.json<{ productId: string }>().productId;
    const mediaId = await uploadProductImage(server, cookie, productId);
    const workingCopy = {
      name: "کفش روزمره",
      description: "کفش سبک برای استفاده روزانه",
      orderedMediaIds: [mediaId],
      axes: [
        {
          clientKey: "size",
          name: "اندازه",
          values: [
            { clientKey: "small", name: "کوچک" },
            { clientKey: "large", name: "بزرگ" },
          ],
        },
      ],
      variants: [
        {
          clientKey: "small",
          combination: [{ axisClientKey: "size", valueClientKey: "small" }],
          price: { amount: 6_000_000, currency: "IRR" as const },
          sku: "SHOE-S",
        },
        {
          clientKey: "large",
          combination: [{ axisClientKey: "size", valueClientKey: "large" }],
          price: { amount: 6_500_000, currency: "IRR" as const },
          sku: "SHOE-L",
        },
      ],
    };
    const saved = productViewContract.parse(
      (
        await server.inject({
          method: "PUT",
          url: `/v1/seller/products/${productId}/working-copy`,
          headers: writeHeaders(cookie, crypto.randomUUID(), 0),
          payload: {
            expectedRevision: 0,
            workingCopy,
            inventory: {
              rows: [
                { variantClientKey: "small", onHand: 2, expectedRevision: 0 },
                { variantClientKey: "large", onHand: 3, expectedRevision: 0 },
              ],
            },
          },
        })
      ).json(),
    );
    const variantIds = Object.fromEntries(
      saved.workingCopy!.variants.map((variant) => [
        variant.clientKey,
        variant.variantId,
      ]),
    );
    const firstPublication = await server.inject({
      method: "POST",
      url: `/v1/seller/products/${productId}/publications`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 1),
      payload: { expectedRevision: 1, confirmed: true },
    });
    expect(firstPublication.statusCode).toBe(200);

    const edited = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${productId}/working-copy`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 2),
      payload: {
        expectedRevision: 2,
        workingCopy: {
          ...workingCopy,
          axes: [
            {
              ...workingCopy.axes[0],
              values: [workingCopy.axes[0]!.values[0]],
            },
          ],
          variants: [workingCopy.variants[0]],
        },
        inventory: null,
      },
    });
    expect(edited.statusCode).toBe(200);

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      const beforePublication = await sql<
        Array<{ variantId: string; retired: boolean }>
      >`
        select id as "variantId", retired from product_variants
        where product_id = ${productId}::uuid order by id
      `;
      expect(beforePublication).toEqual(
        expect.arrayContaining([
          { variantId: variantIds.small, retired: false },
          { variantId: variantIds.large, retired: false },
        ]),
      );
      const stillPublic = publicProductContract.parse(
        (
          await server.inject({
            method: "GET",
            url: `/v1/stores/product-tracer-store/products/${productId}`,
          })
        ).json(),
      );
      expect(stillPublic.variants.map((variant) => variant.variantId)).toEqual(
        expect.arrayContaining([variantIds.small, variantIds.large]),
      );

      const [ownership] = await sql<
        Array<{ storeId: string; actorId: string; eventId: string }>
      >`
        select product.store_id as "storeId", membership.seller_id as "actorId",
          event.event_id as "eventId"
        from product_products product
        join store_memberships membership on membership.store_id = product.store_id
        join platform_outbox_events event on event.aggregate_id = product.id
          and event.event_type = 'ProductPublished.v2'
        where product.id = ${productId}::uuid
        limit 1
      `;
      const inventoryReader = new PostgresInventoryAuthoring(
        apiTestEnvironment.DATABASE_URL,
      );
      const rollbackProbe = new PostgresProductRepository(
        apiTestEnvironment.DATABASE_URL,
        inventoryReader,
        () => ownership!.eventId,
      );
      try {
        await expect(
          rollbackProbe.publishProduct(productId, ownership!.storeId, {
            operation: "PUBLISH_PRODUCT",
            actorId: ownership!.actorId as never,
            correlationId: crypto.randomUUID(),
            idempotencyKey: crypto.randomUUID(),
            expectedRevision: 3,
            requestHash: "f".repeat(64),
          }),
        ).rejects.toThrow();
        const rolledBack = await sql<
          Array<{ revision: number; publicationVersion: number }>
        >`
          select revision, publication_version as "publicationVersion"
          from product_products where id = ${productId}::uuid
        `;
        expect(rolledBack).toEqual([{ revision: 3, publicationVersion: 1 }]);
        expect(
          await sql<Array<{ count: number }>>`
            select count(*)::int as count from product_publications
            where product_id = ${productId}::uuid
          `,
        ).toEqual([{ count: 1 }]);
        expect(
          await sql<Array<{ retired: boolean }>>`
            select retired from product_variants
            where id = ${variantIds.large}::uuid
          `,
        ).toEqual([{ retired: false }]);

        const publishKey = crypto.randomUUID();
        const publicationRequest = {
          method: "POST" as const,
          url: `/v1/seller/products/${productId}/publications`,
          headers: writeHeaders(cookie, publishKey, 3),
          payload: { expectedRevision: 3, confirmed: true },
        };
        const secondPublication = await server.inject(publicationRequest);
        expect(secondPublication.statusCode).toBe(200);
        expect((await server.inject(publicationRequest)).json()).toEqual(
          secondPublication.json(),
        );
        expect(
          await rollbackProbe.readAuthoritativeVariant(variantIds.large as never),
        ).toBeUndefined();
      } finally {
        await rollbackProbe.onModuleDestroy();
        await inventoryReader.onModuleDestroy();
      }

      const afterPublication = await sql<
        Array<{ variantId: string; retired: boolean; everPublished: boolean }>
      >`
        select id as "variantId", retired, ever_published as "everPublished"
        from product_variants where product_id = ${productId}::uuid order by id
      `;
      expect(afterPublication).toEqual(
        expect.arrayContaining([
          { variantId: variantIds.small, retired: false, everPublished: true },
          { variantId: variantIds.large, retired: true, everPublished: true },
        ]),
      );
      const publications = await sql<Array<{ snapshot: unknown }>>`
        select snapshot from product_publications
        where product_id = ${productId}::uuid order by publication_version
      `;
      expect(publications).toHaveLength(2);
      expect(
        publicProductContract
          .parse(publications[0]!.snapshot)
          .variants.map((variant) => variant.variantId),
      ).toEqual(expect.arrayContaining([variantIds.small, variantIds.large]));
      expect(
        publicProductContract
          .parse(publications[1]!.snapshot)
          .variants.map((variant) => variant.variantId),
      ).toEqual([variantIds.small]);
      const publicationEvents = await sql<
        Array<{ count: number; hasCausation: boolean }>
      >`
        select count(*)::int as count,
          bool_and(causation_id is not null) as "hasCausation"
        from platform_outbox_events
        where aggregate_id = ${productId}::uuid
          and event_type = 'ProductPublished.v2'
      `;
      expect(publicationEvents).toEqual([{ count: 2, hasCausation: true }]);
    } finally {
      await sql.end();
    }
  });

  it("keeps deterministic variant identities and applies offer and inventory batches atomically", async () => {
    const { server, cookie } = await startSellerProductTest();

    const created = await server.inject({
      method: "POST",
      url: "/v1/seller/products",
      headers: { cookie, "idempotency-key": crypto.randomUUID() },
      payload: {},
    });
    const productId = created.json<{ productId: string }>().productId;
    const mediaId = await uploadProductImage(server, cookie, productId);
    const workingCopy = {
      name: "پیراهن روزمره",
      description: "پارچه نرم و مناسب استفاده روزانه",
      orderedMediaIds: [mediaId],
      axes: [
        {
          clientKey: "color",
          name: "رنگ",
          values: [{ clientKey: "red", name: "قرمز" }],
        },
        {
          clientKey: "size",
          name: "اندازه",
          values: [
            { clientKey: "small", name: "کوچک" },
            { clientKey: "large", name: "بزرگ" },
          ],
        },
      ],
      variants: [
        {
          clientKey: "red-small",
          combination: [
            { axisClientKey: "color", valueClientKey: "red" },
            { axisClientKey: "size", valueClientKey: "small" },
          ],
          price: { amount: 7_500_000, currency: "IRR" },
          sku: "SHIRT-R-S",
        },
        {
          clientKey: "red-large",
          combination: [
            { axisClientKey: "color", valueClientKey: "red" },
            { axisClientKey: "size", valueClientKey: "large" },
          ],
          price: { amount: 7_900_000, currency: "IRR" },
          sku: "SHIRT-R-L",
        },
      ],
    };
    const savedResponse = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${productId}/working-copy`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 0),
      payload: {
        expectedRevision: 0,
        workingCopy,
        inventory: {
          rows: [
            { variantClientKey: "red-small", onHand: 4, expectedRevision: 0 },
            { variantClientKey: "red-large", onHand: 0, expectedRevision: 0 },
          ],
        },
      },
    });
    expect(savedResponse.statusCode).toBe(200);
    const saved = productViewContract.parse(savedResponse.json());
    const variantIds = saved.workingCopy!.variants.map((variant) => variant.variantId);

    const resavedResponse = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${productId}/working-copy`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 1),
      payload: {
        expectedRevision: 1,
        workingCopy: {
          ...workingCopy,
          axes: [...workingCopy.axes].reverse(),
          variants: [...workingCopy.variants].reverse().map((variant) => ({
            ...variant,
            combination: [...variant.combination].reverse(),
          })),
        },
        inventory: null,
      },
    });
    const resaved = productViewContract.parse(resavedResponse.json());
    expect(
      Object.fromEntries(
        resaved.workingCopy!.variants.map((variant) => [
          variant.clientKey,
          variant.variantId,
        ]),
      ),
    ).toEqual(
      Object.fromEntries(
        saved.workingCopy!.variants.map((variant) => [
          variant.clientKey,
          variant.variantId,
        ]),
      ),
    );

    const offers = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${productId}/offers`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 2),
      payload: {
        expectedRevision: 2,
        rows: resaved.workingCopy!.variants.map((variant, index) => ({
          variantId: variant.variantId,
          price: { amount: 8_000_000 + index * 400_000, currency: "IRR" },
          sku: variant.sku,
          expectedRevision: variant.offerRevision,
        })),
      },
    });
    expect(offers.statusCode).toBe(200);

    const inventory = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${productId}/inventory`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 3),
      payload: {
        expectedRevision: 3,
        reasonCode: "MANUAL_COUNT",
        rows: saved.inventory.map((row) => ({
          variantId: row.variantId,
          onHand: row.onHand + 2,
          expectedRevision: row.revision,
        })),
      },
    });
    expect(inventory.statusCode).toBe(200);

    const rejectedInventory = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${productId}/inventory`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 4),
      payload: {
        expectedRevision: 4,
        reasonCode: "MANUAL_COUNT",
        rows: saved.inventory.map((row, index) => ({
          variantId: row.variantId,
          onHand: 99,
          expectedRevision: index === 0 ? row.revision + 1 : 999,
        })),
      },
    });
    expect(rejectedInventory.statusCode).toBe(409);

    const preview = await server.inject({
      method: "GET",
      url: `/v1/seller/products/${productId}/preview`,
      headers: { cookie },
    });
    const ready = productPreviewContract.parse(preview.json());
    expect(ready).toMatchObject({ ready: true, issues: [] });
    expect(ready.product.inventory.map((row) => row.onHand).sort()).toEqual([2, 6]);

    const published = await server.inject({
      method: "POST",
      url: `/v1/seller/products/${productId}/publications`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 4),
      payload: { expectedRevision: 4, confirmed: true },
    });
    expect(published.statusCode).toBe(200);
    const publicProduct = publicProductContract.parse(published.json());
    expect(publicProduct.priceRange).toMatchObject({
      minimum: { amount: 8_000_000 },
      maximum: { amount: 8_400_000 },
    });
    expect(publicProduct.variants.map((variant) => variant.availability)).toEqual([
      "AVAILABLE",
      "AVAILABLE",
    ]);
    expect(JSON.stringify(publicProduct)).not.toMatch(/sku|onHand/i);

    const concurrentEdits = await Promise.all(
      ["پیراهن نسخه کاری الف", "پیراهن نسخه کاری ب"].map((name) =>
        server.inject({
          method: "PUT",
          url: `/v1/seller/products/${productId}/working-copy`,
          headers: writeHeaders(cookie, crypto.randomUUID(), 5),
          payload: {
            expectedRevision: 5,
            workingCopy: { ...workingCopy, name },
            inventory: null,
          },
        }),
      ),
    );
    expect(concurrentEdits.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const unchangedPublic = await server.inject({
      method: "GET",
      url: `/v1/stores/product-tracer-store/products/${productId}`,
    });
    expect(publicProductContract.parse(unchangedPublic.json()).name).toBe(
      "پیراهن روزمره",
    );

    const changedOffers = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${productId}/offers`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 6),
      payload: {
        expectedRevision: 6,
        rows: ready.product.workingCopy!.variants.map((variant, index) => ({
          variantId: variant.variantId,
          price: { amount: 8_100_000 + index * 400_000, currency: "IRR" },
          sku: variant.sku,
          expectedRevision: 2,
        })),
      },
    });
    expect(changedOffers.statusCode).toBe(200);
    const inventoryReader = new PostgresInventoryAuthoring(
      apiTestEnvironment.DATABASE_URL,
    );
    const productReader = new PostgresProductRepository(
      apiTestEnvironment.DATABASE_URL,
      inventoryReader,
    );
    const readSql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      const firstVariant = ready.product.workingCopy!.variants[0]!.variantId;
      const authoritative = await productReader.readAuthoritativeVariant(firstVariant);
      expect(productAuthoritativeVariantV1Contract.parse(authoritative)).toMatchObject({
        productId,
        variantId: firstVariant,
        name: "پیراهن روزمره",
        unitPrice: { amount: 8_100_000, currency: "IRR" },
        publicationVersion: 1,
        sellable: true,
      });
      expect(
        await readSql.begin((transaction) =>
          productReader.readAuthoritativeVariantInTransaction(
            createOpaqueProductTransactionContext(transaction),
            firstVariant,
          ),
        ),
      ).toEqual(authoritative);
      expect(
        await productReader.readAuthoritativeVariant(crypto.randomUUID() as never),
      ).toBeUndefined();
    } finally {
      await productReader.onModuleDestroy();
      await inventoryReader.onModuleDestroy();
      await readSql.end();
    }

    const stockRace = await Promise.all(
      [crypto.randomUUID(), crypto.randomUUID()].map((key) =>
        server.inject({
          method: "PUT",
          url: `/v1/seller/products/${productId}/inventory`,
          headers: writeHeaders(cookie, key, 7),
          payload: {
            expectedRevision: 7,
            reasonCode: "MANUAL_COUNT",
            rows: ready.product.inventory.map((row) => ({
              variantId: row.variantId,
              onHand: 0,
              expectedRevision: row.revision,
            })),
          },
        }),
      ),
    );
    expect(stockRace.map((response) => response.statusCode).sort()).toEqual([200, 409]);

    const refreshedPublic = publicProductContract.parse(
      (
        await server.inject({
          method: "GET",
          url: `/v1/stores/product-tracer-store/products/${productId}`,
        })
      ).json(),
    );
    expect(refreshedPublic).toMatchObject({
      name: "پیراهن روزمره",
      availability: "OUT_OF_STOCK",
      priceRange: {
        minimum: { amount: 8_100_000 },
        maximum: { amount: 8_500_000 },
      },
    });

    const unpublishKey = crypto.randomUUID();
    const unpublicationRequest = {
      method: "POST" as const,
      url: `/v1/seller/products/${productId}/unpublication`,
      headers: writeHeaders(cookie, unpublishKey, 8),
      payload: { expectedRevision: 8, reasonCode: "SELLER_REQUEST" },
    };
    const unpublished = await server.inject(unpublicationRequest);
    expect(unpublished.statusCode).toBe(200);
    expect(unpublished.json()).toMatchObject({
      productId,
      state: "UNPUBLISHED",
      revision: 9,
      publicationVersion: 1,
    });
    expect((await server.inject(unpublicationRequest)).json()).toEqual(
      unpublished.json(),
    );
    expect(
      (
        await server.inject({
          method: "GET",
          url: `/v1/stores/product-tracer-store/products/${productId}`,
        })
      ).statusCode,
    ).toBe(404);

    const incompleteRepublishDraft = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${productId}/working-copy`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 9),
      payload: {
        expectedRevision: 9,
        workingCopy: { ...workingCopy, name: null },
        inventory: null,
      },
    });
    expect(incompleteRepublishDraft.statusCode).toBe(200);
    const rejectedRepublish = await server.inject({
      method: "POST",
      url: `/v1/seller/products/${productId}/publications`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 10),
      payload: { expectedRevision: 10, confirmed: true },
    });
    expect(rejectedRepublish.statusCode).toBe(422);
    expect(rejectedRepublish.json()).toMatchObject({
      code: "PUBLICATION_NOT_READY",
    });
    const readyRepublishDraft = await server.inject({
      method: "PUT",
      url: `/v1/seller/products/${productId}/working-copy`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 10),
      payload: {
        expectedRevision: 10,
        workingCopy: { ...workingCopy, name: "پیراهن بازنشرشده" },
        inventory: null,
      },
    });
    expect(readyRepublishDraft.statusCode).toBe(200);

    const republished = await server.inject({
      method: "POST",
      url: `/v1/seller/products/${productId}/publications`,
      headers: writeHeaders(cookie, crypto.randomUUID(), 11),
      payload: { expectedRevision: 11, confirmed: true },
    });
    expect(republished.statusCode).toBe(200);
    expect(publicProductContract.parse(republished.json())).toMatchObject({
      name: "پیراهن بازنشرشده",
      publicationVersion: 2,
      availability: "OUT_OF_STOCK",
    });

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      const publicationEvents = await sql<Array<{ payload: unknown }>>`
        select payload from platform_outbox_events
        where aggregate_id = ${productId}::uuid
          and event_type = 'ProductPublished.v2'
      `;
      expect(publicationEvents).toHaveLength(2);
      expect(publicationEvents[0]?.payload).toMatchObject({
        snapshot: { variantIds: expect.arrayContaining(variantIds) },
      });
      expect(JSON.stringify(publicationEvents[0]?.payload)).not.toMatch(
        /پیراهن|sku|onHand|name|description|image|url/i,
      );
      const unpublicationEvents = await sql<Array<{ payload: unknown }>>`
        select payload from platform_outbox_events
        where aggregate_id = ${productId}::uuid
          and event_type = 'ProductUnpublished.v1'
      `;
      expect(unpublicationEvents).toEqual([
        { payload: { storeId: expect.any(String), productId, publicationVersion: 1 } },
      ]);
      const lifecycleAudit = await sql<
        Array<{
          previousState: string;
          nextState: string;
          reasonCode: string;
          previousRevision: number;
          nextRevision: number;
        }>
      >`
        select previous_state as "previousState", next_state as "nextState",
          reason_code as "reasonCode", previous_revision as "previousRevision",
          next_revision as "nextRevision"
        from product_state_transitions where product_id = ${productId}::uuid
      `;
      expect(lifecycleAudit).toEqual([
        {
          previousState: "PUBLISHED",
          nextState: "UNPUBLISHED",
          reasonCode: "SELLER_REQUEST",
          previousRevision: 8,
          nextRevision: 9,
        },
      ]);
      await expect(sql`truncate table product_state_transitions`).rejects.toThrow(
        "product_state_transitions is append-only",
      );
      const eventCounts = await sql<Array<{ eventType: string; count: number }>>`
        select event_type as "eventType", count(*)::int as count
        from platform_outbox_events
        where aggregate_id in ${sql(variantIds)}
          and event_type in ('VariantPriceChanged.v1', 'VariantAvailabilityChanged.v1')
        group by event_type
        order by event_type
      `;
      expect(eventCounts).toEqual([
        { eventType: "VariantAvailabilityChanged.v1", count: 2 },
        { eventType: "VariantPriceChanged.v1", count: 2 },
      ]);
      const schemas = {
        "ProductPublished.v2": productPublishedV2Contract,
        "ProductUnpublished.v1": productUnpublishedV1Contract,
        "VariantPriceChanged.v1": variantPriceChangedV1Contract,
        "VariantAvailabilityChanged.v1": variantAvailabilityChangedV1Contract,
      };
      const observed: string[] = [];
      await replayOutboxEventHistory(sql, {
        eventTypes: [...Object.keys(schemas), "ProductPublished.v1"],
        handler: async (event) => {
          if (
            event.aggregateId !== productId &&
            !variantIds.includes(event.aggregateId)
          )
            return;
          expect(event.eventType).not.toBe("ProductPublished.v1");
          const schema = schemas[event.eventType as keyof typeof schemas];
          expect(schema.parse(event)).toEqual(event);
          observed.push(event.eventType);
        },
      });
      expect(observed.sort()).toEqual([
        "ProductPublished.v2",
        "ProductPublished.v2",
        "ProductUnpublished.v1",
        "VariantAvailabilityChanged.v1",
        "VariantAvailabilityChanged.v1",
        "VariantPriceChanged.v1",
        "VariantPriceChanged.v1",
      ]);
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

async function simpleVariantState(productId: string) {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  try {
    return await sql<Array<{ clientKey: string; everPublished: boolean }>>`
      select client_key as "clientKey", ever_published as "everPublished"
      from product_variants where product_id = ${productId}
    `;
  } finally {
    await sql.end();
  }
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
