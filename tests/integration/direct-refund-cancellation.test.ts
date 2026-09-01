import { createHash, randomUUID } from "node:crypto";

import {
  identityIdContract,
  orderIdContract,
  storeIdContract,
} from "@sevo/contracts/platform/v1";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresFulfillmentRepository } from "../../apps/api/src/modules/fulfillment/composition";
import { createApiApp } from "../../apps/api/src/create-app";
import { PostgresInventoryAuthoring } from "../../apps/api/src/modules/inventory/composition";
import { PostgresCheckoutRepository } from "../../apps/api/src/modules/orders/composition";
import { PostgresDirectRefundRepository } from "../../apps/api/src/modules/payments/infrastructure/postgres-direct-refund.repository";
import { DevDirectPaymentProvider } from "../../apps/api/src/modules/payments/testing/dev-direct-payment-provider";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const ids = {
  actor: identityIdContract.parse("15000000-0000-4000-8000-000000000135"),
  buyer: identityIdContract.parse("25000000-0000-4000-8000-000000000135"),
  store: storeIdContract.parse("35000000-0000-4000-8000-000000000135"),
  variant: "45000000-0000-4000-8000-000000000135",
  cart: "55000000-0000-4000-8000-000000000135",
  checkout: "65000000-0000-4000-8000-000000000135",
  order: orderIdContract.parse("75000000-0000-4000-8000-000000000135"),
  reservation: "85000000-0000-4000-8000-000000000135",
  attempt: "95000000-0000-4000-8000-000000000135",
};

describe("direct-settlement refund cancellation transaction", () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 2 });
  const inventory = new PostgresInventoryAuthoring(apiTestEnvironment.DATABASE_URL);
  const orders = new PostgresCheckoutRepository(
    apiTestEnvironment.DATABASE_URL,
    inventory,
  );
  const fulfillment = new PostgresFulfillmentRepository(
    apiTestEnvironment.DATABASE_URL,
  );
  const refunds = new PostgresDirectRefundRepository(
    apiTestEnvironment.DATABASE_URL,
    inventory,
    orders,
    fulfillment,
  );

  beforeEach(async () => {
    await cleanup();
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${ids.variant}, ${ids.store}, 4, 2)
    `;
    await sql`
      insert into order_carts
        (id, store_id, identity_id, status, revision, expires_at)
      values
        (${ids.cart}, ${ids.store}, ${ids.buyer}, 'CONVERTED', 1,
         now() + interval '1 day')
    `;
    await sql`
      insert into order_checkout_preparations
        (checkout_revision, identity_id, cart_id, cart_revision,
         shipping_method_id, shipping_revision, policy_revision, snapshot, expires_at)
      values
        (${ids.checkout}, ${ids.buyer}, ${ids.cart}, 1, ${randomUUID()}, 1, 1,
         '{}', now() + interval '1 day')
    `;
    await sql`
      insert into order_orders
        (id, identity_id, store_id, checkout_revision, reservation_id, status,
         total_amount, currency, reservation_expires_at, review_snapshot, paid_at)
      values
        (${ids.order}, ${ids.buyer}, ${ids.store}, ${ids.checkout},
         ${ids.reservation}, 'PAID', 2000, 'IRR', now() + interval '1 day',
         '{}', now())
    `;
    await sql`
      insert into inventory_reservations
        (id, order_id, store_id, status, expires_at)
      values
        (${ids.reservation}, ${ids.order}, ${ids.store}, 'CONSUMED',
         now() + interval '1 day')
    `;
    await sql`
      insert into inventory_reservation_lines (reservation_id, variant_id, quantity)
      values (${ids.reservation}, ${ids.variant}, 2)
    `;
    await sql`
      insert into payment_attempts
        (id, order_id, identity_id, status, amount, currency, provider,
         provider_reference, confirmed_at)
      values
        (${ids.attempt}, ${ids.order}, ${ids.buyer}, 'CONFIRMED', 2000, 'IRR',
         'DEV', 'dev-refund-135', now())
    `;
    await sql`
      insert into fulfillment_orders
        (order_id, store_id, status, version, accepted_event_id, created_at, updated_at)
      values
        (${ids.order}, null, 'ACTION_REQUIRED', 1, ${randomUUID()}, now(), now())
    `;
    await sql`
      insert into fulfillment_timeline_entries
        (id, order_id, version, status, actor_type, correlation_id, occurred_at)
      values
        (${randomUUID()}, ${ids.order}, 1, 'ACTION_REQUIRED', 'SYSTEM',
         ${randomUUID()}, now())
    `;
  });

  afterAll(async () => {
    await cleanup();
    await refunds.onModuleDestroy();
    await fulfillment.onModuleDestroy();
    await orders.onModuleDestroy();
    await inventory.onModuleDestroy();
    await sql.end();
  });

  it("does not cancel or restock on failure, then confirms and restocks once", async () => {
    const requested = await refunds.request(
      command(
        "refund-request-135",
        { reason: "کالا پیش از ارسال قابل تأمین نیست." },
        "2026-08-31T08:00:00.000Z",
      ),
    );
    expect(requested).toMatchObject({
      status: "PENDING",
      orderStatus: "CANCELLATION_PENDING_REFUND",
    });

    const failedCommand = resultCommand(
      "refund-failed-135",
      { result: "FAILED", evidenceReference: "provider-result-135-1" },
      "2026-08-31T08:05:00.000Z",
    );
    const failed = await refunds.recordResult(failedCommand);
    expect(await refunds.recordResult(failedCommand)).toEqual(failed);
    expect(failed).toMatchObject({
      status: "FAILED",
      orderStatus: "CANCELLATION_PENDING_REFUND",
      nextAction: "RETRY_REFUND",
    });
    expect(await state()).toMatchObject({
      orderStatus: "CANCELLATION_PENDING_REFUND",
      fulfillmentStatus: "CANCELLATION_PENDING_REFUND",
      reservationStatus: "CONSUMED",
      onHand: 4,
      refundAuditCount: 2,
    });

    const wrongAmount = resultCommand(
      "refund-wrong-amount-135",
      { result: "CONFIRMED", evidenceReference: "provider-result-135-wrong" },
      "2026-08-31T08:07:00.000Z",
    );
    wrongAmount.input.amount.amount = 2010;
    await expect(refunds.recordResult(wrongAmount)).rejects.toMatchObject({
      code: "REFUND_AMOUNT_MISMATCH",
    });
    expect(await state()).toMatchObject({
      orderStatus: "CANCELLATION_PENDING_REFUND",
      reservationStatus: "CONSUMED",
      onHand: 4,
      refundAuditCount: 2,
    });

    const confirmedCommand = resultCommand(
      "refund-confirmed-135",
      { result: "CONFIRMED", evidenceReference: "provider-result-135-2" },
      "2026-08-31T08:10:00.000Z",
    );
    const confirmed = await refunds.recordResult(confirmedCommand);
    expect(await refunds.recordResult(confirmedCommand)).toEqual(confirmed);
    expect(confirmed).toMatchObject({
      status: "CONFIRMED",
      orderStatus: "CANCELLED",
      nextAction: "NONE",
    });
    expect(await state()).toMatchObject({
      orderStatus: "CANCELLED",
      fulfillmentStatus: "CANCELLED",
      reservationStatus: "CANCELLED",
      onHand: 6,
      refundAuditCount: 3,
      inventoryAdjustmentCount: 1,
    });
    const events = await sql<Array<{ eventType: string; payload: unknown }>>`
      select event_type as "eventType", payload from platform_outbox_events
      where aggregate_id = ${ids.order}
        and event_type in ('DirectRefundPending.v1', 'DirectRefundFailed.v1',
          'DirectRefundConfirmed.v1')
      order by created_at
    `;
    expect(events.map((event) => event.eventType)).toEqual([
      "DirectRefundPending.v1",
      "DirectRefundFailed.v1",
      "DirectRefundConfirmed.v1",
    ]);
    expect(JSON.stringify(events)).not.toMatch(/provider-result|قابل تأمین/);
  });

  it("keeps seller routes authenticated and rejects an unsigned provider result", async () => {
    const app = await createApiApp(apiTestEnvironment);
    const server = app.getHttpAdapter().getInstance();
    try {
      for (const request of [
        {
          method: "POST" as const,
          url: `/v1/seller/orders/${ids.order}/direct-refund`,
          payload: { reason: "کالا پیش از ارسال قابل تأمین نیست." },
        },
        {
          method: "GET" as const,
          url: `/v1/seller/orders/${ids.order}/direct-refund`,
        },
      ]) {
        const response = await server.inject(request);
        expect(response.statusCode).toBe(401);
        expect(response.headers["cache-control"]).toBe("no-store");
      }
      const unverified = await server.inject({
        method: "POST",
        url: "/internal/v1/payment-providers/DEV/direct-refunds",
        headers: { "idempotency-key": "unverified-refund-result-135" },
        payload: {
          paymentAttemptId: ids.attempt,
          orderId: ids.order,
          amount: { amount: 2000, currency: "IRR" },
          result: "CONFIRMED",
          evidenceReference: "provider-result-135-unsigned",
          providerEventId: "provider-refund-135-unsigned",
          signature: "0".repeat(64),
        },
      });
      expect(unverified.statusCode).toBe(422);
      expect(await state()).toMatchObject({ orderStatus: "PAID", onHand: 4 });

      await refunds.request(
        command(
          "refund-request-http-135",
          { reason: "کالا پیش از ارسال قابل تأمین نیست." },
          "2026-08-31T08:00:00.000Z",
        ),
      );
      const provider = new DevDirectPaymentProvider(
        "sevo-local-dev-payment-fixture-secret",
      );
      const verified = await server.inject({
        method: "POST",
        url: "/internal/v1/payment-providers/DEV/direct-refunds",
        headers: { "idempotency-key": "verified-refund-result-135" },
        payload: provider.refundCallback({
          paymentAttemptId: ids.attempt,
          orderId: ids.order,
          amount: { amount: 2000, currency: "IRR" },
          result: "FAILED",
          evidenceReference: "provider-result-135-signed",
          providerEventId: "provider-refund-135-signed",
        }),
      });
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).not.toHaveProperty("evidenceReference");
      expect(await state()).toMatchObject({
        orderStatus: "CANCELLATION_PENDING_REFUND",
        reservationStatus: "CONSUMED",
        onHand: 4,
      });
    } finally {
      await app.close();
    }
  });

  it("rejects cancellation once shipment has started", async () => {
    await sql`
      update fulfillment_orders set status = 'SHIPPED', version = 2,
        store_id = ${ids.store}
      where order_id = ${ids.order}
    `;
    await expect(
      refunds.request(
        command(
          "refund-after-shipment-135",
          { reason: "درخواست لغو پس از شروع ارسال ثبت شده است." },
          "2026-08-31T08:00:00.000Z",
        ),
      ),
    ).rejects.toMatchObject({ code: "CANCELLATION_NOT_ALLOWED" });
    expect(await state()).toMatchObject({
      orderStatus: "PAID",
      fulfillmentStatus: "SHIPPED",
      reservationStatus: "CONSUMED",
      onHand: 4,
      refundAuditCount: 0,
    });
  });

  it("preserves large IRR amounts and keeps refund audits append-only", async () => {
    const largeAmount = 3_000_000_000;
    await sql`
      update order_orders set total_amount = ${largeAmount} where id = ${ids.order}
    `;
    await sql`
      update payment_attempts set amount = ${largeAmount} where id = ${ids.attempt}
    `;

    const requested = await refunds.request(
      command(
        "refund-large-amount-135",
        { reason: "کالا پیش از ارسال برای این سفارش قابل تأمین نیست." },
        "2026-08-31T08:00:00.000Z",
      ),
    );
    expect(requested.amount).toEqual({ amount: largeAmount, currency: "IRR" });
    expect(await refunds.readForSeller(ids.store, ids.order)).toEqual(requested);
    await expect(
      sql`
        update payment_direct_refund_audits set actor_reference = 'changed'
        where order_id = ${ids.order}
      `,
    ).rejects.toThrow("payment_direct_refund_audits is append-only");
    await expect(
      sql`delete from payment_direct_refund_audits where order_id = ${ids.order}`,
    ).rejects.toThrow("payment_direct_refund_audits is append-only");
  });

  function command<T extends object>(key: string, input: T, occurredAt: string) {
    return {
      orderId: ids.order,
      actorId: ids.actor,
      storeId: ids.store,
      idempotencyKey: key,
      requestHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
      correlationId: randomUUID(),
      causationId: randomUUID(),
      occurredAt: new Date(occurredAt),
      input,
    };
  }

  function resultCommand(
    key: string,
    input: { result: "CONFIRMED" | "FAILED"; evidenceReference: string },
    occurredAt: string,
  ) {
    const normalized = {
      paymentAttemptId: ids.attempt,
      amount: { amount: 2000, currency: "IRR" as const },
      ...input,
    };
    return {
      orderId: ids.order,
      providerKey: "DEV",
      providerEventId: `${key}-event`,
      idempotencyKey: key,
      requestHash: createHash("sha256")
        .update(JSON.stringify(normalized))
        .digest("hex"),
      correlationId: randomUUID(),
      causationId: randomUUID(),
      occurredAt: new Date(occurredAt),
      input: normalized,
    };
  }

  async function state() {
    const [row] = await sql<
      Array<{
        orderStatus: string;
        fulfillmentStatus: string;
        reservationStatus: string;
        onHand: number;
        refundAuditCount: number;
        inventoryAdjustmentCount: number;
      }>
    >`
      select orders.status as "orderStatus", fulfillment.status as "fulfillmentStatus",
        reservation.status as "reservationStatus", level.on_hand as "onHand",
        (select count(*)::int from payment_direct_refund_audits
          where order_id = ${ids.order}) as "refundAuditCount",
        (select count(*)::int from inventory_adjustments
          where correlation_id in (
            select correlation_id from payment_direct_refund_audits
            where order_id = ${ids.order}
          )) as "inventoryAdjustmentCount"
      from order_orders orders
      join fulfillment_orders fulfillment on fulfillment.order_id = orders.id
      join inventory_reservations reservation on reservation.order_id = orders.id
      join inventory_levels level on level.variant_id = ${ids.variant}
      where orders.id = ${ids.order}
    `;
    return row;
  }

  async function cleanup() {
    await sql`delete from payment_direct_refund_idempotency_records where order_id = ${ids.order}`;
    await sql.begin(async (transaction) => {
      await transaction`set local session_replication_role = replica`;
      await transaction`
        delete from payment_direct_refund_audits where order_id = ${ids.order}
      `;
    });
    await sql`delete from payment_direct_refunds where order_id = ${ids.order}`;
    await sql`delete from fulfillment_idempotency_records where order_id = ${ids.order}`;
    await sql`delete from fulfillment_timeline_entries where order_id = ${ids.order}`;
    await sql`delete from fulfillment_orders where order_id = ${ids.order}`;
    await sql`delete from platform_outbox_events where aggregate_id = ${ids.order}`;
    await sql`delete from order_state_transitions where order_id = ${ids.order}`;
    await sql`delete from inventory_reservation_lines where reservation_id = ${ids.reservation}`;
    await sql`delete from inventory_reservations where id = ${ids.reservation}`;
    await sql`delete from payment_attempts where id = ${ids.attempt}`;
    await sql`delete from order_items where order_id = ${ids.order}`;
    await sql`delete from order_orders where id = ${ids.order}`;
    await sql`delete from order_checkout_preparations where checkout_revision = ${ids.checkout}`;
    await sql`delete from order_carts where id = ${ids.cart}`;
    await sql`delete from inventory_levels where variant_id = ${ids.variant}`;
  }
});
