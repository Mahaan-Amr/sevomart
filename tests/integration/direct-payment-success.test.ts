import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresInventoryAuthoring } from "../../apps/api/src/modules/inventory/composition";
import { PostgresCheckoutRepository } from "../../apps/api/src/modules/orders/composition";
import { DirectPaymentApplicationService } from "../../apps/api/src/modules/payments/application/direct-payment.service";
import { PostgresDirectPaymentRepository } from "../../apps/api/src/modules/payments/infrastructure/postgres-direct-payment.repository";
import { DirectPaymentAmountMismatchError } from "../../apps/api/src/modules/payments/public";
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
  const provider = new (class extends DevDirectPaymentProvider {
    initiationCount = 0;
    override async initiate(
      command: Parameters<DevDirectPaymentProvider["initiate"]>[0],
    ) {
      this.initiationCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return super.initiate(command);
    }
  })("integration-payment-secret");
  const orders = new PostgresCheckoutRepository(
    apiTestEnvironment.DATABASE_URL,
    inventory,
  );
  const payments = new PostgresDirectPaymentRepository(
    apiTestEnvironment.DATABASE_URL,
    inventory,
    orders,
    provider.providerKey,
  );
  const service = new DirectPaymentApplicationService(payments, provider);

  beforeEach(async () => {
    provider.initiationCount = 0;
    await sql`delete from payment_attempt_audits where attempt_id in (select id from payment_attempts where order_id = ${ids.order})`;
    await sql`delete from payment_provider_observations where attempt_id in (select id from payment_attempts where order_id = ${ids.order})`;
    await sql`delete from payment_idempotency_records where identity_id = ${ids.buyer}`;
    await sql`delete from platform_outbox_events where aggregate_id = ${ids.order} or aggregate_id in (select id from payment_attempts where order_id = ${ids.order})`;
    await sql`delete from payment_attempts where order_id = ${ids.order}`;
    await sql`delete from order_state_transitions where order_id = ${ids.order}`;
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
    await orders.onModuleDestroy();
    await inventory.onModuleDestroy();
    await sql.end();
  });

  it("dispatches before callback and confirms inventory/order only once", async () => {
    expect(await orders.listActionableByStore(ids.store as never)).toEqual([]);
    const createCommand = {
      identityId: ids.buyer,
      orderId: ids.order,
      idempotencyKey: "pay-once",
      correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
    } as const;
    const concurrent = await Promise.allSettled([
      service.createAttempt(createCommand),
      service.createAttempt(createCommand),
    ]);
    const fulfilled = concurrent.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof service.createAttempt>>
      > => result.status === "fulfilled",
    );
    expect(fulfilled).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    const attempt = fulfilled[0]!.value;
    expect(provider.initiationCount).toBe(1);
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
      await sql`select event_type as "eventType", payload from platform_outbox_events where aggregate_id in (${ids.order}, ${attempt.attemptId}) order by event_type`,
    ).toEqual([
      {
        eventType: "DirectPaymentAttemptConfirmed.v1",
        payload: { amount: { amount: 4500000, currency: "IRR" }, status: "CONFIRMED" },
      },
      {
        eventType: "DirectPaymentAttemptCreated.v1",
        payload: { amount: { amount: 4500000, currency: "IRR" }, status: "CREATED" },
      },
      {
        eventType: "DirectPaymentAttemptDispatched.v1",
        payload: { status: "DISPATCHED" },
      },
      { eventType: "OrderBecameActionable.v1", payload: { status: "PAID" } },
    ]);
    expect(
      await sql`select from_status as "fromStatus", to_status as "toStatus", correlation_id as "correlationId" from payment_attempt_audits where attempt_id = ${attempt.attemptId} order by occurred_at`,
    ).toEqual([
      {
        fromStatus: null,
        toStatus: "CREATED",
        correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
      },
      {
        fromStatus: "CREATED",
        toStatus: "DISPATCHED",
        correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
      },
      {
        fromStatus: "DISPATCHED",
        toStatus: "CONFIRMED",
        correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
      },
    ]);
    expect(
      await sql`select from_status as "fromStatus", to_status as "toStatus", correlation_id as "correlationId" from order_state_transitions where order_id = ${ids.order}`,
    ).toEqual([
      {
        fromStatus: "PENDING_PAYMENT",
        toStatus: "PAID",
        correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
      },
    ]);
    expect(await orders.listActionableByStore(ids.store as never)).toMatchObject([
      { orderId: ids.order, status: "PAID", itemCount: 1 },
    ]);
  });

  it("moves an abandoned dispatch to review after its lease expires", async () => {
    const correlationId = "8609f906-c921-490c-a793-84398fb67e0c";
    const attempt = await payments.prepareAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      attemptId: "a1fe87eb-6c0f-47ca-93ca-9f9a038ca272" as never,
      idempotencyKey: "abandoned-dispatch",
      requestHash: "a".repeat(64),
      correlationId,
      leaseUntil: new Date(Date.now() + 60_000),
    });
    expect(await payments.claimDispatch(attempt.attemptId, correlationId)).toBe(true);
    await sql`update order_orders set reservation_expires_at = now() - interval '1 second' where id = ${ids.order}`;
    await sql`update inventory_reservations set expires_at = now() - interval '1 second' where id = ${ids.reservation}`;
    expect(await orders.expirePendingOrders(new Date())).toBe(0);
    await sql`update payment_attempts set dispatch_lease_until = now() - interval '1 second' where id = ${attempt.attemptId}`;

    expect(await payments.recoverExpiredDispatches(new Date())).toBe(1);
    expect(await payments.recoverExpiredDispatches(new Date())).toBe(0);
    expect(
      await payments.readAttemptForBuyer(ids.buyer as never, attempt.attemptId),
    ).toMatchObject({ attemptId: attempt.attemptId, status: "REVIEW_REQUIRED" });
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PAYMENT_REVIEW" },
    ]);
    expect(
      await sql`select status from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "HELD_FOR_REVIEW" }]);
    expect(await inventory.read(ids.variant as never)).toMatchObject({
      onHand: 2,
      reserved: 1,
      available: 1,
    });
    expect(
      await sql`select event_type as "eventType" from platform_outbox_events where aggregate_id in (${ids.order}, ${attempt.attemptId}) and event_type like '%ReviewRequired.v1' order by event_type`,
    ).toEqual([
      { eventType: "DirectPaymentAttemptReviewRequired.v1" },
      { eventType: "OrderPaymentReviewRequired.v1" },
    ]);
    expect(provider.initiationCount).toBe(0);
  });

  it("records a late confirmed payment without overselling or seller handoff", async () => {
    const correlationId = "browser-request-123";
    const attempt = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "late-confirmation",
      correlationId,
    });
    await sql`update order_orders set status = 'EXPIRED', reservation_expires_at = now() - interval '1 second' where id = ${ids.order}`;
    await sql`update inventory_reservations set status = 'RELEASED', expires_at = now() - interval '1 second', payment_attempt_id = null, hold_lease_until = null where id = ${ids.reservation}`;

    const callback = provider.successCallback({
      attemptId: attempt.attemptId,
      orderId: ids.order,
      amount: 4_500_000,
      providerEventId: "dev-late-confirmed-1",
    });
    await expect(service.applyCallback(callback, correlationId)).resolves.toMatchObject(
      {
        status: "CONFIRMED",
        duplicate: false,
      },
    );
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PAYMENT_REVIEW" },
    ]);
    expect(
      await sql`select status from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "RELEASED" }]);
    expect(
      await sql`select on_hand as "onHand" from inventory_levels where variant_id = ${ids.variant}`,
    ).toEqual([{ onHand: 2 }]);
    expect(await orders.listActionableByStore(ids.store as never)).toEqual([]);
    expect(
      await sql`select result from payment_provider_observations where provider_event_id = 'dev-late-confirmed-1'`,
    ).toEqual([{ result: "CONFIRMED" }]);
    expect(
      await sql`select reason_code as "reasonCode" from order_state_transitions where order_id = ${ids.order}`,
    ).toEqual([{ reasonCode: "PAYMENT_CONFIRMED_STOCK_CONFLICT" }]);
  });

  it("rejects a conflicting signed replay before treating it as duplicate", async () => {
    const attempt = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "conflicting-replay",
      correlationId: "browser-request-456",
    });
    const callback = provider.successCallback({
      attemptId: attempt.attemptId,
      orderId: ids.order,
      amount: 4_500_000,
      providerEventId: "dev-conflicting-replay",
    });
    await service.applyCallback(callback, "browser-request-456");
    const conflicting = provider.successCallback({
      attemptId: attempt.attemptId,
      orderId: ids.order,
      amount: 4_500_010,
      providerEventId: "dev-conflicting-replay",
    });

    await expect(
      service.applyCallback(conflicting, "browser-request-456"),
    ).rejects.toBeInstanceOf(DirectPaymentAmountMismatchError);
    expect(
      await sql`select count(*)::int as count from payment_provider_observations where provider_event_id = 'dev-conflicting-replay'`,
    ).toEqual([{ count: 1 }]);
  });
});
