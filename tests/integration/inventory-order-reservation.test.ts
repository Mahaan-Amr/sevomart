import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { replayOutboxEventHistory, type StoredOutboxEvent } from "@sevo/outbox";
import { variantAvailabilityChangedV1Contract } from "@sevo/contracts/inventory/v1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkoutPreparationContract,
  directSettlementDisclosure,
} from "@sevo/contracts/orders/v1";

import { PostgresInventoryAuthoring } from "../../apps/api/src/modules/inventory/composition";
import {
  InventoryReservedStockConflictError,
  InventoryReservationUnavailableError,
  type InventoryAuthoring,
  type InventoryTransactionContext,
} from "../../apps/api/src/modules/inventory/public";
import { PostgresCheckoutRepository } from "../../apps/api/src/modules/orders/composition";
import { CheckoutIdempotencyInProgressError } from "../../apps/api/src/modules/orders/public";
import {
  createOpaqueProductTransactionContext,
  PostgresProductRepository,
} from "../../apps/api/src/modules/product/composition";
import { StoreService } from "../../apps/api/src/modules/store/application/store.service";
import {
  createOpaqueStoreTransactionContext,
  PostgresStoreRepository,
} from "../../apps/api/src/modules/store/composition";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const variantId = "2a275962-142f-46a9-b767-d54bb57d0dbc";
const storeId = "78bc50d3-364c-4b17-8cbc-86f25c3e9f88";
const productId = "456bc78d-20eb-433e-9e17-da0aaebfe02c";

describe("inventory reservation transaction seam", () => {
  const clients: ReturnType<typeof postgres>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    clients.push(sql);
    await sql`
      delete from order_create_idempotency_records
      where identity_id = '0fc8f4a0-0cf8-4df0-9fde-82234ef66413'
    `;
    await sql`delete from platform_outbox_events where aggregate_id = '47a3f408-858c-45d7-a0bd-ab84a28718ef'`;
    await sql`
      delete from inventory_reservation_lines
      where reservation_id in (
        select id from inventory_reservations where store_id = ${storeId}
      )
    `;
    await sql`delete from inventory_reservations where store_id = ${storeId}`;
    await sql`
      update order_checkout_preparations set consumed_order_id = null
      where checkout_revision = 'e571d3b9-53cb-47de-8e62-31257784a10c'
    `;
    await sql`delete from order_items where order_id = '47a3f408-858c-45d7-a0bd-ab84a28718ef'`;
    await sql`delete from order_delivery_snapshots where order_id = '47a3f408-858c-45d7-a0bd-ab84a28718ef'`;
    await sql`delete from order_shipping_snapshots where order_id = '47a3f408-858c-45d7-a0bd-ab84a28718ef'`;
    await sql`delete from order_policy_snapshots where order_id = '47a3f408-858c-45d7-a0bd-ab84a28718ef'`;
    await sql`delete from order_orders where id = '47a3f408-858c-45d7-a0bd-ab84a28718ef'`;
    await sql`
      delete from order_checkout_preparations
      where checkout_revision = 'e571d3b9-53cb-47de-8e62-31257784a10c'
    `;
    await sql`
      delete from order_carts where id = '15e66295-eecd-4a7d-b06c-1d0909ab89c7'
    `;
    await sql`delete from product_state_transitions where product_id = ${productId}`;
    await sql`delete from product_products where id = ${productId}`;
    await sql`delete from store_stores where id = ${storeId}`;
    await sql`delete from inventory_levels where variant_id = ${variantId}`;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${variantId}, ${storeId}, 1, 1)
    `;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.end()));
  });

  it("allows only one concurrent order to reserve the final sellable unit", async () => {
    const inventory = new PostgresInventoryAuthoring(apiTestEnvironment.DATABASE_URL);
    const reserve = async (orderId: string, reservationId: string) => {
      const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
      clients.push(sql);
      return sql.begin((transaction) =>
        inventory.reserveForOrder(
          transaction as unknown as InventoryTransactionContext,
          {
            orderId,
            reservationId,
            storeId: storeId as never,
            expiresAt: new Date(Date.now() + 15 * 60_000),
            items: [{ variantId: variantId as never, quantity: 1 }],
          },
        ),
      );
    };

    const results = await Promise.allSettled([
      reserve(
        "47a3f408-858c-45d7-a0bd-ab84a28718ef",
        "6070faec-78f8-4a5f-86da-cdd19b39c5a3",
      ),
      reserve(
        "1b44a29f-59ba-47f8-9079-c1d338145e12",
        "077c8973-91a6-48e1-9707-a0472ea65ab6",
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(InventoryReservationUnavailableError),
    });
    expect(await inventory.read(variantId as never)).toMatchObject({
      onHand: 1,
      reserved: 1,
      available: 0,
    });
    await inventory.onModuleDestroy();
  });

  it("emits inventory-owned availability when an adjustment crosses reserved stock", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    clients.push(sql);
    const inventory = new PostgresInventoryAuthoring(apiTestEnvironment.DATABASE_URL);
    const correlationId = crypto.randomUUID();
    try {
      await sql.begin((transaction) =>
        inventory.reserveForOrder(
          transaction as unknown as InventoryTransactionContext,
          {
            orderId: crypto.randomUUID(),
            reservationId: crypto.randomUUID(),
            storeId: storeId as never,
            expiresAt: new Date(Date.now() + 60_000),
            items: [{ variantId: variantId as never, quantity: 1 }],
          },
        ),
      );
      const command = {
        storeId: storeId as never,
        publication: { productId: productId as never, publicationVersion: 1 },
        rows: [{ variantId: variantId as never, onHand: 2, expectedRevision: 1 }],
        reasonCode: "MANUAL_COUNT" as const,
        actorId: "9370e311-bf7a-4f91-a00b-3b9b5a141f51" as never,
        correlationId,
        causationId: correlationId,
      };
      await sql.begin((transaction) =>
        inventory.replaceBatchForProduct(
          transaction as unknown as InventoryTransactionContext,
          command,
        ),
      );
      const events: StoredOutboxEvent[] = [];
      await replayOutboxEventHistory(sql, {
        eventTypes: ["VariantAvailabilityChanged.v1"],
        handler: async (event) => {
          if (event.correlationId === correlationId) events.push(event);
        },
      });
      expect(events).toHaveLength(1);
      expect(variantAvailabilityChangedV1Contract.parse(events[0])).toMatchObject({
        aggregateId: variantId,
        aggregateVersion: 2,
        causationId: correlationId,
        payload: {
          productId,
          variantId,
          availability: "AVAILABLE",
          availabilityVersion: 2,
        },
      });
      expect(await inventory.read(variantId as never)).toEqual({
        onHand: 2,
        reserved: 1,
        available: 1,
        revision: 2,
      });
      const adjust = (onHand: number, expectedRevision: number) =>
        sql.begin((transaction) =>
          inventory.replaceBatchForProduct(
            transaction as unknown as InventoryTransactionContext,
            {
              ...command,
              rows: [{ variantId: variantId as never, onHand, expectedRevision }],
            },
          ),
        );
      await adjust(3, 2); // Available stays positive: no public event.
      await expect(adjust(0, 3)).rejects.toBeInstanceOf(
        InventoryReservedStockConflictError,
      );
      await adjust(1, 3); // Availability crosses zero without invalidating the hold.
      await expect(adjust(1, 3)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      await expect(
        sql.begin(async (transaction) => {
          await inventory.replaceBatchForProduct(
            transaction as unknown as InventoryTransactionContext,
            {
              ...command,
              rows: [{ variantId: variantId as never, onHand: 2, expectedRevision: 4 }],
            },
          );
          throw new Error("rollback after inventory event");
        }),
      ).rejects.toThrow("rollback after inventory event");
      events.length = 0;
      await replayOutboxEventHistory(sql, {
        eventTypes: ["VariantAvailabilityChanged.v1"],
        handler: async (event) => {
          if (event.correlationId === correlationId) events.push(event);
        },
      });
      expect(
        events.map(
          (event) => variantAvailabilityChangedV1Contract.parse(event).payload,
        ),
      ).toEqual([
        {
          storeId,
          productId,
          variantId,
          publicationVersion: 1,
          availabilityVersion: 2,
          availability: "AVAILABLE",
        },
        {
          storeId,
          productId,
          variantId,
          publicationVersion: 1,
          availabilityVersion: 4,
          availability: "OUT_OF_STOCK",
        },
      ]);
      const finalSnapshot = { onHand: 1, reserved: 1, available: 0, revision: 4 };
      expect(await inventory.read(variantId as never)).toEqual(finalSnapshot);
      expect(await inventory.readMany([variantId as never])).toEqual([
        { variantId, ...finalSnapshot },
      ]);
      expect(
        await sql.begin((transaction) =>
          inventory.readInTransaction(
            transaction as unknown as InventoryTransactionContext,
            variantId as never,
          ),
        ),
      ).toEqual(finalSnapshot);
      expect(await inventory.read(crypto.randomUUID() as never)).toBeUndefined();
    } finally {
      await inventory.onModuleDestroy();
    }
  });

  it("makes an expired unpaid reservation sellable without reducing on-hand", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    clients.push(sql);
    await sql`
      insert into inventory_reservations (id, order_id, store_id, status, expires_at)
      values
        ('6070faec-78f8-4a5f-86da-cdd19b39c5a3',
         '47a3f408-858c-45d7-a0bd-ab84a28718ef', ${storeId}, 'ACTIVE',
         now() - interval '1 second')
    `;
    await sql`
      insert into inventory_reservation_lines (reservation_id, variant_id, quantity)
      values ('6070faec-78f8-4a5f-86da-cdd19b39c5a3', ${variantId}, 1)
    `;
    const inventory = new PostgresInventoryAuthoring(apiTestEnvironment.DATABASE_URL);

    expect(await inventory.read(variantId as never)).toMatchObject({
      onHand: 1,
      reserved: 0,
      available: 1,
    });
    await inventory.onModuleDestroy();
  });

  it("expires an unpaid order, releases its reservation and emits the fact once", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    clients.push(sql);
    const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef";
    const reservationId = "6070faec-78f8-4a5f-86da-cdd19b39c5a3";
    const cartId = "15e66295-eecd-4a7d-b06c-1d0909ab89c7";
    const checkoutRevision = "e571d3b9-53cb-47de-8e62-31257784a10c";
    await sql`
      insert into order_carts
        (id, store_id, identity_id, status, revision, expires_at)
      values
        (${cartId}, ${storeId}, '0fc8f4a0-0cf8-4df0-9fde-82234ef66413',
         'ACTIVE', 1, now() + interval '1 day')
    `;
    await sql`
      insert into order_checkout_preparations
        (checkout_revision, identity_id, cart_id, cart_revision,
         shipping_method_id, shipping_revision, policy_revision, snapshot, expires_at)
      values
        (${checkoutRevision}, '0fc8f4a0-0cf8-4df0-9fde-82234ef66413',
         ${cartId}, 1, 'be77af55-ce97-46d5-8540-b5d55652daf1', 1, 1, '{}',
         now() + interval '1 day')
    `;
    await sql`
      insert into order_orders
        (id, identity_id, store_id, checkout_revision, reservation_id, status,
         total_amount, currency, reservation_expires_at, review_snapshot)
      values
        (${orderId}, '0fc8f4a0-0cf8-4df0-9fde-82234ef66413', ${storeId},
         ${checkoutRevision}, ${reservationId},
         'PENDING_PAYMENT', 1000, 'IRR', now() - interval '1 second', '{}')
    `;
    await sql`
      insert into inventory_reservations (id, order_id, store_id, status, expires_at)
      values (${reservationId}, ${orderId}, ${storeId}, 'ACTIVE',
        now() - interval '1 second')
    `;
    await sql`
      insert into inventory_reservation_lines (reservation_id, variant_id, quantity)
      values (${reservationId}, ${variantId}, 1)
    `;
    const inventory = new PostgresInventoryAuthoring(apiTestEnvironment.DATABASE_URL);
    const orders = new PostgresCheckoutRepository(
      apiTestEnvironment.DATABASE_URL,
      inventory,
    );

    expect(await orders.expirePendingOrders(new Date())).toBe(1);
    expect(await orders.expirePendingOrders(new Date())).toBe(0);
    expect(
      await sql`select status from order_orders where id = ${orderId}`,
    ).toMatchObject([{ status: "EXPIRED" }]);
    expect(
      await sql`select status from inventory_reservations where id = ${reservationId}`,
    ).toMatchObject([{ status: "RELEASED" }]);
    expect(
      await sql`
        select event_type as "eventType" from platform_outbox_events
        where aggregate_id = ${orderId} and event_type = 'OrderExpired.v1'
      `,
    ).toEqual([{ eventType: "OrderExpired.v1" }]);

    await orders.onModuleDestroy();
    await inventory.onModuleDestroy();
  });

  it("reports a live create-order lease and permits takeover after it expires", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    clients.push(sql);
    const identityId = "0fc8f4a0-0cf8-4df0-9fde-82234ef66413";
    const requestHash = "a".repeat(64);
    await sql`
      insert into order_create_idempotency_records
        (identity_id, key, request_hash, state, locked_until)
      values
        (${identityId}, 'concurrent-create', ${requestHash}, 'IN_PROGRESS',
         now() + interval '30 seconds')
    `;
    const inventory = new PostgresInventoryAuthoring(apiTestEnvironment.DATABASE_URL);
    const orders = new PostgresCheckoutRepository(
      apiTestEnvironment.DATABASE_URL,
      inventory,
    );

    await expect(
      orders.replayOrder(identityId as never, "concurrent-create", requestHash),
    ).rejects.toBeInstanceOf(CheckoutIdempotencyInProgressError);
    await sql`
      update order_create_idempotency_records
      set locked_until = now() - interval '1 second'
      where identity_id = ${identityId} and key = 'concurrent-create'
    `;
    await expect(
      orders.replayOrder(identityId as never, "concurrent-create", requestHash),
    ).resolves.toBeUndefined();

    await orders.onModuleDestroy();
    await inventory.onModuleDestroy();
  });

  it("takes over an expired lease and gives concurrent/repeated CreateOrder one effect", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    clients.push(sql);
    const identityId = "0fc8f4a0-0cf8-4df0-9fde-82234ef66413";
    const cartId = "15e66295-eecd-4a7d-b06c-1d0909ab89c7";
    const checkoutRevision = "e571d3b9-53cb-47de-8e62-31257784a10c";
    const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef";
    const reservationId = "6070faec-78f8-4a5f-86da-cdd19b39c5a3";
    const shippingId = "be77af55-ce97-46d5-8540-b5d55652daf1";
    const requestHash = "b".repeat(64);
    await sql`
      insert into store_stores
        (id, name, slug, return_policy, return_policy_revision,
         settlement_kind, settlement_status, settlement_verified_at,
         status, publication_version, revision, updated_at)
      values
        (${storeId}, 'خانه فنجان', 'reservation-integration',
         'تا هفت روز امکان درخواست مرجوعی دارید.', 2,
         'TEST', 'TEST_VERIFIED', now(), 'PUBLISHED', 1, 1, now())
    `;
    await sql`
      insert into store_memberships (id, store_id, seller_id, role)
      values ('04ff38ef-6b33-42e7-9e2a-72aa4706365b', ${storeId},
        '9370e311-bf7a-4f91-a00b-3b9b5a141f51', 'OWNER')
    `;
    await sql`
      insert into store_shipping_methods
        (id, store_id, position, revision, code, label, fixed_fee_amount,
         estimated_delivery_text, enabled, requires_delivery_address,
         requires_postal_code)
      values
        (${shippingId}, ${storeId}, 0, 1, 'PICKUP', 'تحویل حضوری', 0,
         'هماهنگی با فروشگاه', true, false, false)
    `;
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at)
      values (${productId}, ${storeId}, 'PUBLISHED', 2, 3, now())
    `;
    await sql`
      insert into product_variants
        (id, product_id, store_id, client_key, combination_key,
         retired, ever_published)
      values (${variantId}, ${productId}, ${storeId}, 'default', 'default', false, true)
    `;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id, variant_id)
      values (${productId}, 3, 'فنجان سرامیکی', 'فنجان دست‌ساز',
        '807c619f-a989-4fd9-8b78-a437a07c7bc4', ${variantId})
    `;
    await sql`
      insert into product_offers (product_id, variant_id, amount, currency, revision)
      values (${productId}, ${variantId}, 4500000, 'IRR', 1)
    `;
    await sql`
      insert into order_carts
        (id, store_id, identity_id, status, revision, reviewed_policy_revision,
         reviewed_shipping_hash, expires_at)
      values (${cartId}, ${storeId}, ${identityId}, 'ACTIVE', 4, 2,
        ${"c".repeat(64)}, now() + interval '1 day')
    `;
    await sql`
      insert into order_cart_items
        (cart_id, variant_id, product_id, quantity,
         reviewed_publication_version, reviewed_unit_price_amount)
      values (${cartId}, ${variantId}, ${productId}, 1, 3, 4500000)
    `;
    const preparation = checkoutPreparationContract.parse({
      checkoutRevision,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      cart: { cartId, revision: 4 },
      store: { storeId, name: "خانه فنجان" },
      items: [
        {
          productId,
          variantId,
          name: "فنجان سرامیکی",
          quantity: 1,
          publicationVersion: 3,
          unitPrice: { amount: 4_500_000, currency: "IRR" },
          lineTotal: { amount: 4_500_000, currency: "IRR" },
        },
      ],
      shippingMethod: {
        id: shippingId,
        revision: 1,
        code: "PICKUP",
        label: "تحویل حضوری",
        fee: { amount: 0, currency: "IRR" },
        estimatedDeliveryText: "هماهنگی با فروشگاه",
        requiresDeliveryAddress: false,
      },
      returnPolicy: {
        revision: 2,
        text: "تا هفت روز امکان درخواست مرجوعی دارید.",
      },
      subtotal: { amount: 4_500_000, currency: "IRR" },
      total: { amount: 4_500_000, currency: "IRR" },
      settlement: { mode: "DIRECT", disclosure: directSettlementDisclosure },
    });
    const inventory = new PostgresInventoryAuthoring(apiTestEnvironment.DATABASE_URL);
    const products = new PostgresProductRepository(
      apiTestEnvironment.DATABASE_URL,
      inventory,
    );
    const storeRepository = new PostgresStoreRepository(
      apiTestEnvironment.DATABASE_URL,
    );
    const stores = new StoreService(storeRepository, async () => ({
      kind: "TEST",
      status: "TEST_VERIFIED",
      verifiedAt: new Date(),
    }));
    const orders = new PostgresCheckoutRepository(
      apiTestEnvironment.DATABASE_URL,
      inventory,
      products,
      stores,
      createOpaqueProductTransactionContext,
      createOpaqueStoreTransactionContext,
    );
    await orders.savePreparation({
      identityId: identityId as never,
      input: {
        cartId: cartId as never,
        cartRevision: 4,
        shippingMethodId: shippingId,
        shippingMethodRevision: 1,
      },
      preparation,
    });
    await sql`
      insert into order_create_idempotency_records
        (identity_id, key, request_hash, state, locked_until)
      values (${identityId}, 'create-once', ${requestHash}, 'IN_PROGRESS',
        now() - interval '1 second')
    `;
    const command = {
      identityId: identityId as never,
      orderId,
      reservationId,
      input: {
        checkoutRevision,
        cartRevision: 4,
        shippingMethodRevision: 1,
        returnPolicyRevision: 2,
      },
      idempotencyKey: "create-once",
      requestHash,
      correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
      reservationExpiresAt: new Date(Date.now() + 15 * 60_000),
    };

    const failingInventory = new Proxy(inventory, {
      get(target, property, receiver) {
        if (property === "reserveForOrder") {
          return async (
            transaction: InventoryTransactionContext,
            reservation: Parameters<InventoryAuthoring["reserveForOrder"]>[1],
          ) => {
            await target.reserveForOrder(transaction, reservation);
            throw new Error("simulated post-reservation participant failure");
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const failingOrders = new PostgresCheckoutRepository(
      apiTestEnvironment.DATABASE_URL,
      failingInventory,
      products,
      stores,
      createOpaqueProductTransactionContext,
      createOpaqueStoreTransactionContext,
    );
    await expect(failingOrders.createOrder(command)).rejects.toThrow(
      "simulated post-reservation participant failure",
    );
    expect(
      await sql`
        select id from order_orders where checkout_revision = ${checkoutRevision}
      `,
    ).toHaveLength(0);
    expect(
      await sql`select id from inventory_reservations where order_id = ${orderId}`,
    ).toHaveLength(0);
    expect(
      await sql`
        select event_id from platform_outbox_events where aggregate_id = ${orderId}
      `,
    ).toHaveLength(0);
    expect(
      await sql`
        select order_id from order_items where order_id = ${orderId}
        union all
        select order_id from order_shipping_snapshots where order_id = ${orderId}
        union all
        select order_id from order_policy_snapshots where order_id = ${orderId}
        union all
        select order_id from order_delivery_snapshots where order_id = ${orderId}
      `,
    ).toHaveLength(0);
    await failingOrders.onModuleDestroy();

    const concurrent = await Promise.allSettled([
      orders.createOrder(command),
      orders.createOrder({
        ...command,
        orderId: "2f6f2c2a-c338-45f0-9a09-06f55ea18567",
        reservationId: "dd68df77-f5e4-4bfa-a384-d0755640e4fd",
      }),
    ]);
    for (const result of concurrent.filter(
      (candidate) => candidate.status === "rejected",
    )) {
      expect(result).toMatchObject({
        reason: expect.any(CheckoutIdempotencyInProgressError),
      });
    }
    const winner = concurrent.find((candidate) => candidate.status === "fulfilled");
    expect(winner?.status).toBe("fulfilled");
    if (!winner || winner.status !== "fulfilled") {
      throw new Error("One concurrent CreateOrder must succeed");
    }
    const replay = await orders.createOrder({
      ...command,
      orderId: "60335bca-a943-448c-b8a6-aaa8a476543e",
      reservationId: "60e0454f-d3b3-4233-b303-0c03f3cbfdd2",
    });
    expect(replay.orderId).toBe(winner.value.orderId);
    const createdItems = await sql<Array<{ id: string }>>`
      select id from order_items where order_id = ${winner.value.orderId}
    `;
    expect(createdItems).toHaveLength(1);
    expect(createdItems[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    await expect(
      sql`
        insert into order_items
          (id, order_id, variant_id, product_id, name, quantity,
           unit_price_amount, publication_version)
        values
          (${createdItems[0]!.id}, ${winner.value.orderId}, ${randomUUID()}, ${productId},
           'قلم تکراری', 1, 4500000, 3)
      `,
    ).rejects.toMatchObject({ code: "23505" });
    expect(
      await sql<Array<{ id: string }>>`
        select id from order_items where order_id = ${winner.value.orderId}
      `,
    ).toEqual(createdItems);
    expect(
      await sql`select id from order_orders where checkout_revision = ${checkoutRevision}`,
    ).toHaveLength(1);
    expect(
      await sql`
        select id from inventory_reservations where order_id = ${winner.value.orderId}
      `,
    ).toHaveLength(1);
    expect(
      await sql`
        select event_id from platform_outbox_events
        where aggregate_id = ${winner.value.orderId} and event_type = 'OrderCreated.v1'
      `,
    ).toHaveLength(1);

    await orders.onModuleDestroy();
    await products.onModuleDestroy();
    await storeRepository.onModuleDestroy();
    await inventory.onModuleDestroy();
  });
});
