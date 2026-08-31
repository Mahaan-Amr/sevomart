import { randomUUID } from "node:crypto";

import { fulfillmentAdvancedV1Contract } from "@sevo/contracts/fulfillment/v1";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { projectRelatedBuyerFulfillmentStatus } from "../../apps/worker/src/modules/orders/index";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 2 });

afterAll(async () => sql.end());

describe("related store buyers and contextual delivery reveal", () => {
  it("pages only the seller store, searches name/order, and audits delivered reveal", async () => {
    const app = await createApiApp({
      ...apiTestEnvironment,
      DEV_OTP_TEST_MOBILES: undefined,
    });
    const server = app.getHttpAdapter().getInstance();
    const sellerAccessId = randomUUID();
    const first = orderFixture();
    const olderFirstBuyerOrder = orderFixture();
    const second = orderFixture();
    const unrelated = orderFixture();
    const firstBuyerId = randomUUID();
    const secondBuyerId = randomUUID();
    const followerOnlyBuyerId = randomUUID();
    const mobile = `0913${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
    let sellerId = "";
    let storeId = "";
    try {
      const requested = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile },
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
      sellerId = session.json().actor.identityId as string;
      await sql`
        insert into identity_seller_access (id, identity_id, status)
        values (${sellerAccessId}, ${sellerId}, 'ACTIVE')
      `;
      const savedStore = await server.inject({
        method: "PUT",
        url: "/v1/seller/store/draft",
        headers: { cookie, "idempotency-key": randomUUID(), "if-match": '"0"' },
        payload: { name: "فروشگاه خریداران مرتبط" },
      });
      expect(savedStore.statusCode).toBe(200);
      storeId = savedStore.json().id as string;

      await insertPaidOrder(first, {
        storeId,
        buyerId: firstBuyerId,
        recipientName: "سارا احمدی",
        recipientMobile: "09123456789",
        createdAt: "2026-08-31T08:00:00.000Z",
      });
      await insertPaidOrder(olderFirstBuyerOrder, {
        storeId,
        buyerId: firstBuyerId,
        recipientName: "سارا احمدی",
        recipientMobile: "09123456789",
        createdAt: "2026-08-29T08:00:00.000Z",
      });
      await insertPaidOrder(second, {
        storeId,
        buyerId: secondBuyerId,
        recipientName: "مینا رضایی",
        recipientMobile: "09351234567",
        createdAt: "2026-08-30T08:00:00.000Z",
      });
      await insertPaidOrder(unrelated, {
        storeId: randomUUID(),
        buyerId: firstBuyerId,
        recipientName: "خریدار فروشگاه دیگر",
        recipientMobile: "09901234567",
        createdAt: "2026-08-31T09:00:00.000Z",
      });
      const deliveredEvent = await projectFulfillmentStatus(
        first.orderId,
        4,
        "SHIPPED",
        "DELIVERED",
      );
      await sql.begin((transaction) =>
        projectRelatedBuyerFulfillmentStatus(deliveredEvent, transaction),
      );
      await projectFulfillmentStatus(first.orderId, 3, "PREPARING", "SHIPPED");
      expect(
        await sql`
          select status, version from order_fulfillment_status_projections
          where order_id = ${first.orderId}
        `,
      ).toEqual([{ status: "DELIVERED", version: 4 }]);
      await sql`
        insert into discovery_store_follows
          (relation_id, identity_id, store_id, status, revision, activated_at,
           updated_at)
        values (${randomUUID()}, ${followerOnlyBuyerId}, ${storeId}, 'ACTIVE', 1,
          now(), now())
      `;

      const pageOne = await server.inject({
        method: "GET",
        url: "/v1/seller/buyers?limit=1",
        headers: { cookie },
      });
      expect(pageOne.statusCode).toBe(200);
      expect(pageOne.headers["cache-control"]).toBe("no-store");
      expect(pageOne.json()).toMatchObject({
        items: [
          {
            displayName: "سارا ا.",
            maskedMobile: "0912••••789",
            orderCount: 2,
            latestOrder: {
              orderId: first.orderId,
              paymentStatus: "PAID",
              fulfillmentStatus: "DELIVERED",
            },
          },
        ],
      });
      expect(pageOne.json().items[0]).not.toHaveProperty("recipientMobile");
      expect(pageOne.json().nextCursor).toEqual(expect.any(String));

      const invalidCursor = await server.inject({
        method: "GET",
        url: `/v1/seller/buyers?cursor=${encodeURIComponent(`${pageOne.json().nextCursor}x`)}`,
        headers: { cookie },
      });
      expect(invalidCursor.statusCode).toBe(422);
      expect(invalidCursor.json().code).toBe("INVALID_CURSOR");

      const bulkLimit = await server.inject({
        method: "GET",
        url: "/v1/seller/buyers?limit=500",
        headers: { cookie },
      });
      expect(bulkLimit.statusCode).toBe(422);

      const pageTwo = await server.inject({
        method: "GET",
        url: `/v1/seller/buyers?limit=1&cursor=${encodeURIComponent(pageOne.json().nextCursor)}`,
        headers: { cookie },
      });
      expect(pageTwo.statusCode).toBe(200);
      expect(pageTwo.json().items).toMatchObject([{ displayName: "مینا ر." }]);
      expect(JSON.stringify([pageOne.json(), pageTwo.json()])).not.toContain(
        "خریدار فروشگاه دیگر",
      );
      expect(
        [...pageOne.json().items, ...pageTwo.json().items].map(
          (buyer: { buyerId: string }) => buyer.buyerId,
        ),
      ).not.toContain(followerOnlyBuyerId);

      for (const search of ["سارا", first.orderId]) {
        const found = await server.inject({
          method: "GET",
          url: `/v1/seller/buyers?search=${encodeURIComponent(search)}`,
          headers: { cookie },
        });
        expect(found.statusCode).toBe(200);
        expect(found.json().items).toHaveLength(1);
        expect(found.json().items[0].latestOrder.orderId).toBe(first.orderId);
      }
      const olderOrderSearch = await server.inject({
        method: "GET",
        url: `/v1/seller/buyers?search=${olderFirstBuyerOrder.orderId}`,
        headers: { cookie },
      });
      expect(olderOrderSearch.statusCode).toBe(200);
      expect(olderOrderSearch.json().items[0]).toMatchObject({
        matchedOrderId: olderFirstBuyerOrder.orderId,
        latestOrder: { orderId: first.orderId },
      });

      const historyPageOne = await server.inject({
        method: "GET",
        url: `/v1/seller/orders/${olderFirstBuyerOrder.orderId}/buyer-orders?limit=1`,
        headers: { cookie },
      });
      expect(historyPageOne.statusCode).toBe(200);
      expect(historyPageOne.headers["cache-control"]).toBe("no-store");
      expect(historyPageOne.json()).toMatchObject({
        items: [
          {
            orderId: first.orderId,
            paymentStatus: "PAID",
            fulfillmentStatus: "DELIVERED",
          },
        ],
        nextCursor: expect.any(String),
      });
      expect(historyPageOne.json().items[0]).not.toHaveProperty("buyerId");

      const historyPageTwo = await server.inject({
        method: "GET",
        url: `/v1/seller/orders/${olderFirstBuyerOrder.orderId}/buyer-orders?limit=1&cursor=${encodeURIComponent(historyPageOne.json().nextCursor)}`,
        headers: { cookie },
      });
      expect(historyPageTwo.statusCode).toBe(200);
      expect(historyPageTwo.json()).toMatchObject({
        items: [{ orderId: olderFirstBuyerOrder.orderId, paymentStatus: "PAID" }],
        nextCursor: null,
      });

      const cursorBoundToContext = await server.inject({
        method: "GET",
        url: `/v1/seller/orders/${second.orderId}/buyer-orders?cursor=${encodeURIComponent(historyPageOne.json().nextCursor)}`,
        headers: { cookie },
      });
      expect(cursorBoundToContext.statusCode).toBe(422);
      expect(cursorBoundToContext.json().code).toBe("INVALID_CURSOR");

      const otherStoreHistory = await server.inject({
        method: "GET",
        url: `/v1/seller/orders/${unrelated.orderId}/buyer-orders`,
        headers: { cookie },
      });
      expect(otherStoreHistory.statusCode).toBe(404);

      await sql`
        update order_fulfillment_status_projections
        set status = 'SHIPPED', version = 2
        where order_id = ${first.orderId}
      `;
      const reasonRequiredDespiteStaleProjection = await server.inject({
        method: "POST",
        url: `/v1/seller/orders/${first.orderId}/delivery-details/reveal`,
        headers: { cookie },
        payload: {},
      });
      expect(reasonRequiredDespiteStaleProjection.statusCode).toBe(422);
      expect(reasonRequiredDespiteStaleProjection.json().code).toBe(
        "REVEAL_REASON_REQUIRED",
      );

      const activeReasonRequired = await server.inject({
        method: "POST",
        url: `/v1/seller/orders/${second.orderId}/delivery-details/reveal`,
        headers: { cookie },
        payload: {},
      });
      expect(activeReasonRequired.statusCode).toBe(422);
      expect(activeReasonRequired.json().code).toBe("REVEAL_REASON_REQUIRED");

      for (const payload of [
        { reason: 123 },
        { reason: "کوتاه" },
        { reason: "پ".repeat(501) },
      ]) {
        const malformedReason = await server.inject({
          method: "POST",
          url: `/v1/seller/orders/${second.orderId}/delivery-details/reveal`,
          headers: { cookie },
          payload,
        });
        expect(malformedReason.statusCode).toBe(422);
        expect(malformedReason.json().code).toBe("VALIDATION_ERROR");
      }

      const blankReason = await server.inject({
        method: "POST",
        url: `/v1/seller/orders/${second.orderId}/delivery-details/reveal`,
        headers: { cookie },
        payload: { reason: "   " },
      });
      expect(blankReason.statusCode).toBe(422);
      expect(blankReason.json().code).toBe("REVEAL_REASON_REQUIRED");

      const revealed = await server.inject({
        method: "POST",
        url: `/v1/seller/orders/${first.orderId}/delivery-details/reveal`,
        headers: { cookie },
        payload: { reason: "پیگیری مشکل اعلام‌شده در تحویل" },
      });
      expect(revealed.statusCode).toBe(200);
      expect(revealed.headers["cache-control"]).toBe("no-store");
      expect(revealed.json()).toMatchObject({
        orderId: first.orderId,
        recipientName: "سارا احمدی",
        recipientMobile: "09123456789",
        fulfillmentStatus: "SHIPPED",
      });

      const activeReveal = await server.inject({
        method: "POST",
        url: `/v1/seller/orders/${second.orderId}/delivery-details/reveal`,
        headers: { cookie },
        payload: { reason: "هماهنگی ارسال در بازه فعال سفارش" },
      });
      expect(activeReveal.statusCode).toBe(200);
      expect(activeReveal.json()).toMatchObject({
        orderId: second.orderId,
        recipientMobile: "09351234567",
      });

      const activeAudits = await sql<
        Array<{ reasonCode: string; reasonHash: string | null }>
      >`
        select reason_code as "reasonCode", reason_hash as "reasonHash"
        from order_sensitive_access_audit where order_id = ${second.orderId}
      `;
      expect(activeAudits).toEqual([
        {
          reasonCode: "ORDER_FOLLOW_UP",
          reasonHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ]);

      const otherStore = await server.inject({
        method: "POST",
        url: `/v1/seller/orders/${unrelated.orderId}/delivery-details/reveal`,
        headers: { cookie },
        payload: { reason: "پیگیری سفارش ثبت‌شده برای انجام" },
      });
      expect(otherStore.statusCode).toBe(404);

      const audits = await sql<
        Array<{
          actorId: string;
          orderId: string;
          reasonCode: string;
          reasonHash: string;
          payload: string;
        }>
      >`
        select actor_identity_id as "actorId", order_id as "orderId",
          reason_code as "reasonCode", reason_hash as "reasonHash",
          row_to_json(order_sensitive_access_audit)::text as payload
        from order_sensitive_access_audit where order_id = ${first.orderId}
      `;
      expect(audits).toMatchObject([
        {
          actorId: sellerId,
          orderId: first.orderId,
          reasonCode: "ORDER_FOLLOW_UP",
          reasonHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ]);
      expect(audits[0]!.payload).not.toMatch(/09123456789|خیابان آزادی/);
      await expect(
        sql`update order_sensitive_access_audit set reason_code = 'ORDER_FOLLOW_UP' where order_id = ${first.orderId}`,
      ).rejects.toThrow(/append-only/);
      await expect(
        sql`delete from order_sensitive_access_audit where order_id = ${first.orderId}`,
      ).rejects.toThrow(/append-only/);

      await sql`
        update identity_seller_access set status = 'SUSPENDED'
        where identity_id = ${sellerId}
      `;
      const inactiveSeller = await server.inject({
        method: "GET",
        url: "/v1/seller/buyers",
        headers: { cookie },
      });
      expect(inactiveSeller.statusCode).toBe(403);
    } finally {
      await sql`
        delete from discovery_store_follows
        where identity_id = ${followerOnlyBuyerId} and store_id = ${storeId || null}
      `;
      for (const fixture of [first, olderFirstBuyerOrder, second, unrelated])
        await cleanupOrder(fixture);
      if (storeId) {
        await sql`delete from store_idempotency_records where actor_identity_id = ${sellerId}`;
        await sql`delete from store_stores where id = ${storeId}`;
      }
      if (sellerId) {
        await sql`delete from identity_seller_access where identity_id = ${sellerId}`;
      }
      await app.close();
    }
  });
});

function orderFixture() {
  return { cartId: randomUUID(), checkoutId: randomUUID(), orderId: randomUUID() };
}

async function insertPaidOrder(
  fixture: ReturnType<typeof orderFixture>,
  input: {
    storeId: string;
    buyerId: string;
    recipientName: string;
    recipientMobile: string;
    createdAt: string;
  },
) {
  await sql`
    insert into order_carts
      (id, store_id, identity_id, status, revision, expires_at)
    values (${fixture.cartId}, ${input.storeId}, ${input.buyerId}, 'CONVERTED', 1,
      now() + interval '1 day')
  `;
  await sql`
    insert into order_checkout_preparations
      (checkout_revision, identity_id, cart_id, cart_revision, shipping_method_id,
       shipping_revision, policy_revision, snapshot, expires_at)
    values (${fixture.checkoutId}, ${input.buyerId}, ${fixture.cartId}, 1,
      ${randomUUID()}, 1, 1, '{}', now() + interval '1 day')
  `;
  await sql`
    insert into order_orders
      (id, identity_id, store_id, checkout_revision, reservation_id, status,
       total_amount, currency, reservation_expires_at, review_snapshot, paid_at,
       created_at)
    values (${fixture.orderId}, ${input.buyerId}, ${input.storeId},
      ${fixture.checkoutId}, ${randomUUID()}, 'PAID', 1000, 'IRR',
      now() + interval '1 day', '{}', ${input.createdAt}, ${input.createdAt})
  `;
  await sql`
    insert into order_delivery_snapshots
      (order_id, address_id, address_revision, recipient_name, recipient_mobile,
       province_text, city_text, address_line, postal_code)
    values (${fixture.orderId}, ${randomUUID()}, 1, ${input.recipientName},
      ${input.recipientMobile}, 'تهران', 'تهران',
      'خیابان آزادی، کوچه بهار، پلاک ۱۲', '1234567890')
  `;
}

async function projectFulfillmentStatus(
  orderId: string,
  aggregateVersion: number,
  fromStatus: "PREPARING" | "SHIPPED",
  toStatus: "SHIPPED" | "DELIVERED",
) {
  const event = fulfillmentAdvancedV1Contract.parse({
    version: 1,
    eventId: randomUUID(),
    eventType: "FulfillmentAdvanced.v1",
    aggregateId: orderId,
    aggregateVersion,
    occurredAt: "2026-08-31T09:00:00.000Z",
    correlationId: randomUUID(),
    causationId: randomUUID(),
    actor: { type: "IDENTITY", id: randomUUID() },
    payload: { fromStatus, toStatus },
  });
  await sql.begin((transaction) =>
    projectRelatedBuyerFulfillmentStatus(event, transaction),
  );
  return event;
}

async function cleanupOrder(fixture: ReturnType<typeof orderFixture>) {
  await sql`delete from order_fulfillment_status_projections where order_id = ${fixture.orderId}`;
  await sql`delete from order_delivery_snapshots where order_id = ${fixture.orderId}`;
  await sql`update order_checkout_preparations set consumed_order_id = null where checkout_revision = ${fixture.checkoutId}`;
  await sql`delete from order_orders where id = ${fixture.orderId}`;
  await sql`delete from order_checkout_preparations where checkout_revision = ${fixture.checkoutId}`;
  await sql`delete from order_carts where id = ${fixture.cartId}`;
}
