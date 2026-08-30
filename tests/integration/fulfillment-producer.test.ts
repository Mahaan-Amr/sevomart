import { createHash, randomUUID } from "node:crypto";

import { fulfillmentTimelineContract } from "@sevo/contracts/fulfillment/v1";
import { orderBecameActionableV1Contract } from "@sevo/contracts/orders/v1";
import {
  identityIdContract,
  orderIdContract,
  storeIdContract,
} from "@sevo/contracts/platform/v1";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { PostgresFulfillmentRepository } from "../../apps/api/src/modules/fulfillment/composition";
import { projectActionableOrder } from "../../apps/worker/src/modules/fulfillment/index";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 2 });
const repository = new PostgresFulfillmentRepository(apiTestEnvironment.DATABASE_URL);
const orderId = orderIdContract.parse("47000000-0000-4000-8000-000000000134");
const actorId = identityIdContract.parse("57000000-0000-4000-8000-000000000134");
const storeId = storeIdContract.parse("77000000-0000-4000-8000-000000000134");

beforeEach(async () => {
  await sql`delete from platform_outbox_consumptions where consumer_name = 'fulfillment-actionable-orders-v1'`;
  await sql`delete from platform_outbox_events where aggregate_id = ${orderId}`;
  await sql`delete from fulfillment_idempotency_records where order_id = ${orderId}`;
  await sql`delete from fulfillment_timeline_entries where order_id = ${orderId}`;
  await sql`delete from fulfillment_orders where order_id = ${orderId}`;
});

afterAll(async () => {
  await repository.onModuleDestroy();
  await sql.end();
});

describe("fulfillment producer persistence", () => {
  it("composes seller and buyer timeline routes behind identity authentication", async () => {
    const app = await createApiApp(apiTestEnvironment);
    const server = app.getHttpAdapter().getInstance();
    try {
      for (const request of [
        { method: "GET", url: `/v1/orders/${orderId}/fulfillment` },
        { method: "GET", url: `/v1/seller/orders/${orderId}/fulfillment` },
        {
          method: "POST",
          url: `/v1/seller/orders/${orderId}/fulfillment/advance`,
          payload: { targetStatus: "PREPARING" },
        },
      ]) {
        const response = await server.inject(request);
        expect(response.statusCode).toBe(401);
        expect(response.headers["cache-control"]).toBe("no-store");
      }
    } finally {
      await app.close();
    }
  });

  it("advances a paid seller order and gives its buyer the same no-store timeline", async () => {
    const app = await createApiApp(apiTestEnvironment);
    const server = app.getHttpAdapter().getInstance();
    const fixtureIds = {
      cartId: randomUUID(),
      checkoutId: randomUUID(),
      orderId: orderId,
    };
    const sellerAccessId = randomUUID();
    let storeId = "";
    let buyerAndSellerId = "";
    try {
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
      buyerAndSellerId = session.json().actor.identityId as string;
      await sql`
        insert into identity_seller_access (id, identity_id, status)
        values (${sellerAccessId}, ${buyerAndSellerId}, 'ACTIVE')
        on conflict (identity_id) do nothing
      `;
      const existingStore = await server.inject({
        method: "GET",
        url: "/v1/seller/store/draft",
        headers: { cookie },
      });
      if (existingStore.statusCode === 200) {
        storeId = existingStore.json().id;
      } else {
        const savedStore = await server.inject({
          method: "PUT",
          url: "/v1/seller/store/draft",
          headers: {
            cookie,
            "idempotency-key": randomUUID(),
            "if-match": '"0"',
          },
          payload: { name: "فروشگاه انجام سفارش" },
        });
        expect(savedStore.statusCode).toBe(200);
        storeId = savedStore.json().id;
      }
      await createPaidOrder({
        ...fixtureIds,
        identityId: buyerAndSellerId,
        storeId,
      });
      await sql.begin((transaction) =>
        projectActionableOrder(actionableEvent(), transaction),
      );

      const sellerRead = await server.inject({
        method: "GET",
        url: `/v1/seller/orders/${orderId}/fulfillment`,
        headers: { cookie },
      });
      const buyerRead = await server.inject({
        method: "GET",
        url: `/v1/orders/${orderId}/fulfillment`,
        headers: { cookie },
      });
      expect(sellerRead.statusCode).toBe(200);
      expect(buyerRead.json()).toEqual(sellerRead.json());
      expect(buyerRead.headers["cache-control"]).toBe("no-store");

      const skipped = await server.inject({
        method: "POST",
        url: `/v1/seller/orders/${orderId}/fulfillment/advance`,
        headers: { cookie, "idempotency-key": "skip-shipment-134" },
        payload: {
          targetStatus: "SHIPPED",
          shipping: { method: "پست پیشتاز" },
        },
      });
      expect(skipped.statusCode).toBe(422);
      expect(skipped.json().code).toBe("INVALID_TRANSITION");

      const preparing = await server.inject({
        method: "POST",
        url: `/v1/seller/orders/${orderId}/fulfillment/advance`,
        headers: { cookie, "idempotency-key": "prepare-order-134" },
        payload: { targetStatus: "PREPARING" },
      });
      expect(preparing.statusCode).toBe(200);

      const missingMethod = await server.inject({
        method: "POST",
        url: `/v1/seller/orders/${orderId}/fulfillment/advance`,
        headers: { cookie, "idempotency-key": "ship-invalid-134" },
        payload: { targetStatus: "SHIPPED" },
      });
      expect(missingMethod.statusCode).toBe(422);

      const busyPayload = {
        targetStatus: "SHIPPED",
        shipping: { method: "پست پیشتاز", trackingCode: "1234567890" },
      } as const;
      const busyKey = "ship-busy-134";
      await sql`
        insert into fulfillment_idempotency_records
          (operation, order_id, actor_id, key, request_hash, state, locked_until,
           correlation_id)
        values
          ('ADVANCE', ${orderId}, ${buyerAndSellerId}, ${busyKey},
           ${createHash("sha256").update(JSON.stringify(busyPayload)).digest("hex")},
           'IN_PROGRESS', now() + interval '30 seconds', ${randomUUID()})
      `;
      const busy = await server.inject({
        method: "POST",
        url: `/v1/seller/orders/${orderId}/fulfillment/advance`,
        headers: { cookie, "idempotency-key": busyKey },
        payload: busyPayload,
      });
      expect(busy.statusCode).toBe(409);
      expect(busy.json().code).toBe("IDEMPOTENCY_IN_PROGRESS");
      expect(busy.headers["retry-after"]).toBe("1");
      await sql`
        delete from fulfillment_idempotency_records
        where operation = 'ADVANCE' and order_id = ${orderId}
          and actor_id = ${buyerAndSellerId} and key = ${busyKey}
      `;

      const shipped = await server.inject({
        method: "POST",
        url: `/v1/seller/orders/${orderId}/fulfillment/advance`,
        headers: { cookie, "idempotency-key": "ship-order-134" },
        payload: {
          targetStatus: "SHIPPED",
          shipping: { method: "پست پیشتاز", trackingCode: "1234567890" },
        },
      });
      expect(shipped.statusCode).toBe(200);
      expect(shipped.json()).toMatchObject({
        status: "SHIPPED",
        nextStatus: "DELIVERED",
        timeline: [
          { status: "ACTION_REQUIRED" },
          { status: "PREPARING" },
          {
            status: "SHIPPED",
            shipping: { method: "پست پیشتاز", trackingCode: "1234567890" },
          },
        ],
      });
      const buyerAfterShipment = await server.inject({
        method: "GET",
        url: `/v1/orders/${orderId}/fulfillment`,
        headers: { cookie },
      });
      expect(buyerAfterShipment.json()).toEqual(shipped.json());
    } finally {
      await cleanupPaidOrder(fixtureIds);
      if (storeId) {
        await sql`delete from store_idempotency_records where actor_identity_id = ${buyerAndSellerId}`;
        await sql`delete from store_stores where id = ${storeId}`;
      }
      await sql`delete from identity_seller_access where id = ${sellerAccessId}`;
      await app.close();
    }
  });

  it("consumes the actionable handoff idempotently and starts an auditable timeline", async () => {
    const event = actionableEvent();
    await sql.begin((transaction) => projectActionableOrder(event, transaction));
    await sql.begin((transaction) => projectActionableOrder(event, transaction));

    expect(await repository.read(orderId)).toEqual({
      orderId,
      status: "ACTION_REQUIRED",
      nextStatus: "PREPARING",
      timeline: [
        {
          status: "ACTION_REQUIRED",
          actor: { type: "SYSTEM" },
          occurredAt: event.occurredAt,
          correlationId: event.correlationId,
        },
      ],
    });
  });

  it("persists sequential transitions, shipment and replay in one audit timeline", async () => {
    const event = actionableEvent();
    await sql.begin((transaction) => projectActionableOrder(event, transaction));
    const preparing = command("PREPARING", "advance-preparing-134");
    await repository.advance(preparing);
    const shipped = command("SHIPPED", "advance-shipped-134", {
      method: "پست پیشتاز",
      trackingCode: "1234567890",
    });
    const result = await repository.advance(shipped);
    const delivered = command("DELIVERED", "advance-delivered-134");
    const deliveredResult = await repository.advance(delivered);

    expect(await repository.replayAdvance(shipped)).toEqual(result);
    expect(fulfillmentTimelineContract.parse(deliveredResult)).toMatchObject({
      status: "DELIVERED",
      timeline: [
        { status: "ACTION_REQUIRED", actor: { type: "SYSTEM" } },
        { status: "PREPARING", actor: { type: "IDENTITY", id: actorId } },
        {
          status: "SHIPPED",
          shipping: { method: "پست پیشتاز", trackingCode: "1234567890" },
        },
        { status: "DELIVERED" },
      ],
    });
    expect(await repository.readOrderSnapshot(orderId)).toEqual({
      storeId,
      status: "DELIVERED",
      shippedAt: "2026-08-30T10:00:00.000Z",
      deliveredAt: "2026-08-30T10:00:00.000Z",
    });

    await expect(
      repository.replayAdvance({
        ...shipped,
        requestHash: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const events = await sql<
      Array<{ causationId: string; payload: Record<string, unknown> }>
    >`
      select causation_id as "causationId", payload from platform_outbox_events
      where aggregate_id = ${orderId} and event_type = 'FulfillmentAdvanced.v1'
      order by aggregate_version
    `;
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.causationId)).toEqual([
      preparing.causationId,
      shipped.causationId,
      delivered.causationId,
    ]);
    expect(JSON.stringify(events)).not.toMatch(/tracking|mobile|address/i);
  });

  it("rejects a stale concurrent transition without a partial audit or event", async () => {
    await sql.begin((transaction) =>
      projectActionableOrder(actionableEvent(), transaction),
    );
    await repository.advance(command("PREPARING", "advance-stale-134"));
    await expect(
      repository.advance(command("PREPARING", "advance-stale-other-134")),
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    const entries = await sql<Array<{ count: number }>>`
      select count(*)::int as count from fulfillment_timeline_entries
      where order_id = ${orderId}
    `;
    expect(entries).toEqual([{ count: 2 }]);
  });

  it("rejects a simultaneous replay while the same idempotency claim is locked", async () => {
    await sql.begin((transaction) =>
      projectActionableOrder(actionableEvent(), transaction),
    );
    const inFlight = command("PREPARING", "advance-concurrent-134");
    const lockKey = [
      "fulfillment",
      "ADVANCE",
      inFlight.orderId,
      inFlight.actorId,
      inFlight.idempotencyKey,
    ].join(":");
    const blocker = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await blocker.begin(async (transaction) => {
        await transaction`
          select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        `;
        await expect(repository.advance(inFlight)).rejects.toMatchObject({
          code: "IDEMPOTENCY_IN_PROGRESS",
        });
      });
    } finally {
      await blocker.end();
    }
    expect(await repository.read(orderId)).toMatchObject({
      status: "ACTION_REQUIRED",
      timeline: [{ status: "ACTION_REQUIRED" }],
    });
  });
});

function actionableEvent() {
  const correlationId = "67000000-0000-4000-8000-000000000134";
  return orderBecameActionableV1Contract.parse({
    version: 1,
    eventId: "77000000-0000-4000-8000-000000000134",
    eventType: "OrderBecameActionable.v1",
    aggregateId: orderId,
    aggregateVersion: 2,
    occurredAt: "2026-08-30T09:00:00.000Z",
    correlationId,
    causationId: "87000000-0000-4000-8000-000000000134",
    actor: { type: "SYSTEM" },
    payload: { status: "PAID" },
  });
}

function command(
  targetStatus: "PREPARING" | "SHIPPED" | "DELIVERED",
  idempotencyKey: string,
  shipping?: { method: string; trackingCode?: string },
) {
  const input =
    targetStatus === "SHIPPED"
      ? { targetStatus, shipping: shipping! }
      : { targetStatus };
  return {
    orderId,
    actorId,
    storeId,
    correlationId: randomUUID(),
    causationId: randomUUID(),
    occurredAt: new Date("2026-08-30T10:00:00.000Z"),
    idempotencyKey,
    requestHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    expectedStatus:
      targetStatus === "PREPARING"
        ? "ACTION_REQUIRED"
        : targetStatus === "SHIPPED"
          ? "PREPARING"
          : "SHIPPED",
    input,
  } as const;
}

async function createPaidOrder(input: {
  cartId: string;
  checkoutId: string;
  orderId: string;
  identityId: string;
  storeId: string;
}) {
  await sql`
    insert into order_carts
      (id, store_id, identity_id, status, revision, expires_at)
    values
      (${input.cartId}, ${input.storeId}, ${input.identityId}, 'CONVERTED', 1,
       now() + interval '1 day')
  `;
  await sql`
    insert into order_checkout_preparations
      (checkout_revision, identity_id, cart_id, cart_revision,
       shipping_method_id, shipping_revision, policy_revision, snapshot, expires_at)
    values
      (${input.checkoutId}, ${input.identityId}, ${input.cartId}, 1,
       ${randomUUID()}, 1, 1, ${sql.json({})}, now() + interval '1 day')
  `;
  await sql`
    insert into order_orders
      (id, identity_id, store_id, checkout_revision, reservation_id, status,
       total_amount, currency, reservation_expires_at, review_snapshot, paid_at)
    values
      (${input.orderId}, ${input.identityId}, ${input.storeId}, ${input.checkoutId},
       ${randomUUID()}, 'PAID', 1000, 'IRR', now() + interval '1 day',
       ${sql.json({})}, now())
  `;
  await sql`
    insert into order_items
      (order_id, variant_id, product_id, name, quantity,
       unit_price_amount, publication_version)
    values
      (${input.orderId}, ${randomUUID()}, ${randomUUID()}, 'کالای آزمون', 1, 1000, 1)
  `;
}

async function cleanupPaidOrder(input: {
  cartId: string;
  checkoutId: string;
  orderId: string;
}) {
  await sql`delete from fulfillment_idempotency_records where order_id = ${input.orderId}`;
  await sql`delete from fulfillment_timeline_entries where order_id = ${input.orderId}`;
  await sql`delete from fulfillment_orders where order_id = ${input.orderId}`;
  await sql`delete from platform_outbox_events where aggregate_id = ${input.orderId}`;
  await sql`delete from order_items where order_id = ${input.orderId}`;
  await sql`delete from order_orders where id = ${input.orderId}`;
  await sql`delete from order_checkout_preparations where checkout_revision = ${input.checkoutId}`;
  await sql`delete from order_carts where id = ${input.cartId}`;
}
