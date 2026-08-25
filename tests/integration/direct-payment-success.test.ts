import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresInventoryAuthoring } from "../../apps/api/src/modules/inventory/composition";
import { DirectPaymentApplicationService } from "../../apps/api/src/modules/payments/application/direct-payment.service";
import { PostgresDirectPaymentRepository } from "../../apps/api/src/modules/payments/infrastructure/postgres-direct-payment.repository";
import { DevDirectPaymentProvider } from "../../apps/api/src/modules/payments/testing/dev-direct-payment-provider";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const ids = {
  buyer: "10000000-0000-4000-8000-000000000001",
  store: "20000000-0000-4000-8000-000000000002",
  variant: "30000000-0000-4000-8000-000000000003",
  cart: "40000000-0000-4000-8000-000000000004",
  checkout: "50000000-0000-4000-8000-000000000005",
  order: "60000000-0000-4000-8000-000000000006",
  reservation: "70000000-0000-4000-8000-000000000007",
};

describe("successful direct payment transaction seam", () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const inventory = new PostgresInventoryAuthoring(apiTestEnvironment.DATABASE_URL);
  const provider = new DevDirectPaymentProvider("integration-payment-secret");
  const payments = new PostgresDirectPaymentRepository(
    apiTestEnvironment.DATABASE_URL,
    inventory,
  );
  const service = new DirectPaymentApplicationService(payments, provider);

  beforeEach(async () => {
    await sql`delete from payment_provider_observations where attempt_id in (select id from payment_attempts where order_id = ${ids.order})`;
    await sql`delete from payment_idempotency_records where identity_id = ${ids.buyer}`;
    await sql`delete from payment_attempts where order_id = ${ids.order}`;
    await sql`delete from platform_outbox_events where aggregate_id in (${ids.order})`;
    await sql`delete from inventory_reservation_lines where reservation_id = ${ids.reservation}`;
    await sql`delete from inventory_reservations where id = ${ids.reservation}`;
    await sql`delete from order_items where order_id = ${ids.order}`;
    await sql`update order_checkout_preparations set consumed_order_id = null where checkout_revision = ${ids.checkout}`;
    await sql`delete from order_orders where id = ${ids.order}`;
    await sql`delete from order_checkout_preparations where checkout_revision = ${ids.checkout}`;
    await sql`delete from order_carts where id = ${ids.cart}`;
    await sql`delete from inventory_levels where variant_id = ${ids.variant}`;

    await sql`insert into inventory_levels (variant_id, store_id, on_hand, revision) values (${ids.variant}, ${ids.store}, 2, 1)`;
    await sql`insert into order_carts (id, store_id, identity_id, status, revision, expires_at) values (${ids.cart}, ${ids.store}, ${ids.buyer}, 'CONVERTED', 1, now() + interval '1 day')`;
    await sql`insert into order_checkout_preparations (checkout_revision, identity_id, cart_id, cart_revision, shipping_method_id, shipping_revision, policy_revision, snapshot, expires_at) values (${ids.checkout}, ${ids.buyer}, ${ids.cart}, 1, '80000000-0000-4000-8000-000000000008', 1, 1, '{}', now() + interval '1 day')`;
    await sql`insert into order_orders (id, identity_id, store_id, checkout_revision, reservation_id, status, total_amount, currency, reservation_expires_at, review_snapshot) values (${ids.order}, ${ids.buyer}, ${ids.store}, ${ids.checkout}, ${ids.reservation}, 'PENDING_PAYMENT', 4500000, 'IRR', now() + interval '15 minutes', ${sql.json({ store: { name: "خانه فنجان" }, items: [] })})`;
    await sql`insert into order_items (order_id, variant_id, product_id, name, quantity, unit_price_amount, publication_version) values (${ids.order}, ${ids.variant}, '90000000-0000-4000-8000-000000000009', 'فنجان سرامیکی', 1, 4500000, 1)`;
    await sql`insert into inventory_reservations (id, order_id, store_id, status, expires_at) values (${ids.reservation}, ${ids.order}, ${ids.store}, 'ACTIVE', now() + interval '15 minutes')`;
    await sql`insert into inventory_reservation_lines (reservation_id, variant_id, quantity) values (${ids.reservation}, ${ids.variant}, 1)`;
  });

  afterAll(async () => {
    await payments.onModuleDestroy();
    await inventory.onModuleDestroy();
    await sql.end();
  });

  it("dispatches before callback and confirms inventory/order only once", async () => {
    expect(await service.listSellerActionable(ids.store)).toEqual([]);
    const attempt = await service.createAttempt({
      identityId: ids.buyer,
      orderId: ids.order,
      idempotencyKey: "pay-once",
      correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
    });
    expect(attempt).toMatchObject({ status: "DISPATCHED", orderId: ids.order });
    expect(
      await sql`select payment_attempt_id as "attemptId", hold_lease_until > now() as held from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ attemptId: attempt.attemptId, held: true }]);

    const callback = provider.successCallback({
      attemptId: attempt.attemptId,
      orderId: ids.order,
      amount: 4_500_000,
      providerEventId: "dev-confirmed-1",
    });
    expect(
      await service.applyCallback(callback, "7609f906-c921-490c-a793-84398fb67e0c"),
    ).toMatchObject({ duplicate: false, status: "CONFIRMED" });
    expect(
      await service.applyCallback(callback, "7609f906-c921-490c-a793-84398fb67e0c"),
    ).toMatchObject({ duplicate: true, status: "CONFIRMED" });

    expect(
      await sql`select status, paid_at is not null as paid from order_orders where id = ${ids.order}`,
    ).toEqual([{ status: "PAID", paid: true }]);
    expect(
      await sql`select status from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "CONSUMED" }]);
    expect(
      await sql`select on_hand as "onHand" from inventory_levels where variant_id = ${ids.variant}`,
    ).toEqual([{ onHand: 1 }]);
    expect(
      await sql`select event_type as "eventType", payload from platform_outbox_events where aggregate_id = ${ids.order} order by event_type`,
    ).toEqual([
      {
        eventType: "DirectPaymentAttemptConfirmed.v1",
        payload: { amount: { amount: 4500000, currency: "IRR" }, status: "CONFIRMED" },
      },
      { eventType: "OrderBecameActionable.v1", payload: { status: "PAID" } },
    ]);
    expect(await service.listSellerActionable(ids.store)).toMatchObject([
      { orderId: ids.order, status: "PAID", itemCount: 1 },
    ]);
  });
});
