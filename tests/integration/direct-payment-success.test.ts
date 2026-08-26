import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresInventoryAuthoring } from "../../apps/api/src/modules/inventory/composition";
import { PostgresCheckoutRepository } from "../../apps/api/src/modules/orders/composition";
import { DirectPaymentApplicationService } from "../../apps/api/src/modules/payments/application/direct-payment.service";
import { PostgresDirectPaymentRepository } from "../../apps/api/src/modules/payments/infrastructure/postgres-direct-payment.repository";
import {
  DirectPaymentAmountMismatchError,
  DirectPaymentAttemptNotFoundError,
} from "../../apps/api/src/modules/payments/public";
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
    failInitiation = false;
    queryCount = 0;
    queryResult: "CONFIRMED" | "FAILED" | "PENDING" = "PENDING";
    override async initiate(
      command: Parameters<DevDirectPaymentProvider["initiate"]>[0],
    ) {
      this.initiationCount += 1;
      if (this.failInitiation) throw new Error("provider timeout");
      await new Promise((resolve) => setTimeout(resolve, 25));
      return super.initiate(command);
    }
    override async query(command: Parameters<DevDirectPaymentProvider["query"]>[0]) {
      this.queryCount += 1;
      return {
        attemptId: command.attemptId,
        orderId: command.orderId,
        amount: command.amount.amount,
        result: this.queryResult,
        providerEventId: `dev-query-${this.queryCount}-${command.attemptId}`,
        providerReference: command.providerReference,
      } as const;
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
    provider.failInitiation = false;
    provider.queryCount = 0;
    provider.queryResult = "PENDING";
    await sql`delete from payment_operational_alerts where attempt_id in (select id from payment_attempts where order_id = ${ids.order})`;
    await sql`delete from payment_attempt_audits where attempt_id in (select id from payment_attempts where order_id = ${ids.order})`;
    await sql`delete from payment_provider_observations where attempt_id in (select id from payment_attempts where order_id = ${ids.order}) or provider_event_id like 'dev-%'`;
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

  it("stores the order reference without a cross-module foreign key", async () => {
    expect(
      await sql`
        select constraint_name as "constraintName"
        from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'payment_attempts'
          and constraint_type = 'FOREIGN KEY'
      `,
    ).toEqual([]);
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

    expect(await payments.recoverExpiredAttempts(new Date(), correlationId)).toBe(1);
    const reviewed = await payments.readAttemptForBuyer(
      ids.buyer as never,
      attempt.attemptId,
    );
    expect(reviewed).toMatchObject({
      attemptId: attempt.attemptId,
      status: "REVIEW_REQUIRED",
    });
    expect(await payments.recoverExpiredAttempts(new Date(), correlationId)).toBe(0);
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PAYMENT_REVIEW" },
    ]);
    expect(
      await service.readAttempt(ids.buyer as never, attempt.attemptId),
    ).toMatchObject({ status: "REVIEW_REQUIRED", orderStatus: "PAYMENT_REVIEW" });
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

  it("recovers an undispatched attempt without extending the original deadline", async () => {
    const correlationId = "d609f906-c921-490c-a793-84398fb67e0c";
    const attempt = await payments.prepareAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      attemptId: "d1fe87eb-6c0f-47ca-93ca-9f9a038ca272" as never,
      idempotencyKey: "crash-before-dispatch",
      requestHash: "d".repeat(64),
      correlationId,
      leaseUntil: new Date(Date.now() - 1_000),
    });

    expect(await payments.recoverExpiredAttempts(new Date(), correlationId)).toBe(1);
    expect(
      await payments.readAttemptForBuyer(ids.buyer as never, attempt.attemptId),
    ).toMatchObject({ status: "FAILED" });
    expect(
      await sql`select status, payment_attempt_id as "attemptId" from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "ACTIVE", attemptId: null }]);
    expect(await payments.recoverExpiredAttempts(new Date(), correlationId)).toBe(0);
  });

  it("releases an undispatched reservation once the original deadline has passed", async () => {
    const correlationId = "4609f906-c921-490c-a793-84398fb67e0c";
    const attempt = await payments.prepareAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      attemptId: "e1fe87eb-6c0f-47ca-93ca-9f9a038ca272" as never,
      idempotencyKey: "crash-before-dispatch-after-deadline",
      requestHash: "e".repeat(64),
      correlationId,
      leaseUntil: new Date(Date.now() + 1_000),
    });
    await sql`
      update order_orders set reservation_expires_at = now() - interval '1 second'
      where id = ${ids.order}
    `;
    await sql`
      update inventory_reservations
      set expires_at = now() - interval '1 second', hold_lease_until = now() - interval '1 second'
      where id = ${ids.reservation}
    `;
    await sql`
      update payment_attempts set dispatch_lease_until = now() - interval '1 second'
      where id = ${attempt.attemptId}
    `;

    expect(await payments.recoverExpiredAttempts(new Date(), correlationId)).toBe(1);
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "EXPIRED" },
    ]);
    expect(
      await service.readAttempt(ids.buyer as never, attempt.attemptId),
    ).toMatchObject({ status: "FAILED", orderStatus: "EXPIRED" });
    expect(
      await sql`select status from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "RELEASED" }]);
  });

  it("treats an initiation timeout as ambiguous instead of guessing failure", async () => {
    provider.failInitiation = true;
    const attempt = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "provider-timeout",
      correlationId: "1609f906-c921-490c-a793-84398fb67e0c",
    });

    expect(attempt.status).toBe("REVIEW_REQUIRED");
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PAYMENT_REVIEW" },
    ]);
    expect(
      await service.readAttempt(ids.buyer as never, attempt.attemptId),
    ).toMatchObject({ status: "REVIEW_REQUIRED", orderStatus: "PAYMENT_REVIEW" });
    expect(
      await sql`select status from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "HELD_FOR_REVIEW" }]);

    await sql`
      update payment_attempts
      set review_started_at = now() - interval '31 minutes',
        next_reconciliation_at = now() - interval '1 second'
      where id = ${attempt.attemptId}
    `;

    provider.failInitiation = false;
    expect(
      await service.reconcileNext(new Date(), "2609f906-c921-490c-a793-84398fb67e0c"),
    ).toBe(true);
    expect(provider.initiationCount).toBe(2);
    expect(provider.queryCount).toBe(0);
    expect(
      await sql`select provider_reference is not null as "hasReference" from payment_attempts where id = ${attempt.attemptId}`,
    ).toEqual([{ hasReference: true }]);
    expect(
      await sql`select kind, status from payment_operational_alerts where attempt_id = ${attempt.attemptId}`,
    ).toEqual([{ kind: "RECONCILIATION_OVERDUE", status: "OPEN" }]);

    provider.queryResult = "FAILED";
    await sql`
      update payment_attempts set next_reconciliation_at = now() - interval '1 second'
      where id = ${attempt.attemptId}
    `;
    expect(
      await service.reconcileNext(new Date(), "browser-reconciliation-request"),
    ).toBe(true);
    expect(provider.queryCount).toBe(1);
    expect(
      await service.readAttempt(ids.buyer as never, attempt.attemptId),
    ).toMatchObject({ status: "FAILED", orderStatus: "PENDING_PAYMENT" });
  });

  it("releases a definite failure back to the original reservation deadline and permits a safe retry", async () => {
    const first = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "failed-attempt",
      correlationId: "browser-failed-payment",
    });

    expect(
      await service.applyCallback(
        provider.callback({
          attemptId: first.attemptId,
          orderId: ids.order,
          amount: 4_500_000,
          result: "FAILED",
          providerEventId: "dev-failed-1",
        }),
        "browser-failed-payment",
      ),
    ).toMatchObject({ status: "FAILED", duplicate: false });
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PENDING_PAYMENT" },
    ]);
    expect(
      await sql`select status, payment_attempt_id as "attemptId", hold_lease_until as "leaseUntil" from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "ACTIVE", attemptId: null, leaseUntil: null }]);
    expect(
      await sql`select count(*)::int as count from platform_outbox_events where aggregate_id = ${first.attemptId} and event_type = 'DirectPaymentAttemptFailed.v1'`,
    ).toEqual([{ count: 1 }]);

    const retry = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "retry-after-failure",
      correlationId: "a609f906-c921-490c-a793-84398fb67e0c",
    });
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(retry.status).toBe("DISPATCHED");
  });

  it("holds an ambiguous result for review and replays its duplicate without a second effect", async () => {
    const attempt = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "pending-attempt",
      correlationId: "b609f906-c921-490c-a793-84398fb67e0c",
    });
    const callback = provider.callback({
      attemptId: attempt.attemptId,
      orderId: ids.order,
      amount: 4_500_000,
      result: "PENDING",
      providerEventId: "dev-pending-1",
    });

    await expect(
      service.applyCallback(callback, "b609f906-c921-490c-a793-84398fb67e0c"),
    ).resolves.toMatchObject({ status: "REVIEW_REQUIRED", duplicate: false });
    await expect(
      service.applyCallback(callback, "b609f906-c921-490c-a793-84398fb67e0c"),
    ).resolves.toMatchObject({ status: "REVIEW_REQUIRED", duplicate: true });
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PAYMENT_REVIEW" },
    ]);
    expect(
      await sql`select status from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "HELD_FOR_REVIEW" }]);
    await expect(
      service.createAttempt({
        identityId: ids.buyer as never,
        orderId: ids.order as never,
        idempotencyKey: "blocked-parallel-payment",
        correlationId: "c609f906-c921-490c-a793-84398fb67e0c",
      }),
    ).rejects.toThrow();
    expect(
      await sql`select count(*)::int as count from payment_attempt_audits where attempt_id = ${attempt.attemptId} and to_status = 'REVIEW_REQUIRED'`,
    ).toEqual([{ count: 1 }]);
    expect(await service.listReviewRequired()).toMatchObject([
      {
        attempt: { attemptId: attempt.attemptId, status: "REVIEW_REQUIRED" },
        reviewKind: "RESULT_AMBIGUOUS",
        alertKinds: [],
        audits: [
          { toStatus: "CREATED", reasonCode: "PAYMENT_ATTEMPT_CREATED" },
          { toStatus: "DISPATCHED", reasonCode: "PROVIDER_DISPATCH_CLAIMED" },
          { toStatus: "REVIEW_REQUIRED", reasonCode: "PROVIDER_RESULT_PENDING" },
        ],
      },
    ]);

    provider.queryResult = "CONFIRMED";
    await expect(
      service.reconcileNext(new Date(), "e609f906-c921-490c-a793-84398fb67e0c"),
    ).resolves.toBe(true);
    expect(provider.queryCount).toBe(1);
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PAID" },
    ]);
    expect(
      await sql`select status from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "CONSUMED" }]);
  });

  it("reconciles a reviewed payment to failure without extending its deadline", async () => {
    const attempt = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "review-then-fail",
      correlationId: "f609f906-c921-490c-a793-84398fb67e0c",
    });
    await service.applyCallback(
      provider.callback({
        attemptId: attempt.attemptId,
        orderId: ids.order,
        amount: 4_500_000,
        result: "PENDING",
        providerEventId: "dev-review-before-failure",
      }),
      "f609f906-c921-490c-a793-84398fb67e0c",
    );

    await expect(
      service.applyCallback(
        provider.callback({
          attemptId: attempt.attemptId,
          orderId: ids.order,
          amount: 4_500_000,
          result: "FAILED",
          providerEventId: "dev-failed-after-review",
        }),
        "0609f906-c921-490c-a793-84398fb67e0c",
      ),
    ).resolves.toMatchObject({ status: "FAILED", duplicate: false });
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PENDING_PAYMENT" },
    ]);
    expect(
      await sql`select status, payment_attempt_id as "attemptId" from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "ACTIVE", attemptId: null }]);
  });

  it("records a late success after reservation release without overselling or seller handoff", async () => {
    const attempt = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "late-success",
      correlationId: "2609f906-c921-490c-a793-84398fb67e0c",
    });
    await sql`
      update inventory_reservations
      set status = 'RELEASED', payment_attempt_id = null, hold_lease_until = null
      where id = ${ids.reservation}
    `;
    await sql`update order_orders set status = 'EXPIRED' where id = ${ids.order}`;

    await expect(
      service.applyCallback(
        provider.successCallback({
          attemptId: attempt.attemptId,
          orderId: ids.order,
          amount: 4_500_000,
          providerEventId: "dev-late-confirmed",
        }),
        "2609f906-c921-490c-a793-84398fb67e0c",
      ),
    ).resolves.toMatchObject({ status: "CONFIRMED", duplicate: false });
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PAYMENT_REVIEW" },
    ]);
    expect(
      await service.readAttempt(ids.buyer as never, attempt.attemptId),
    ).toMatchObject({ status: "CONFIRMED", orderStatus: "PAYMENT_REVIEW" });
    expect(
      await sql`select status from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "RELEASED" }]);
    expect(
      await sql`select on_hand as "onHand" from inventory_levels where variant_id = ${ids.variant}`,
    ).toEqual([{ onHand: 2 }]);
    expect(await orders.listActionableByStore(ids.store as never)).toEqual([]);
    expect(
      await sql`select count(*)::int as count from platform_outbox_events where aggregate_id = ${ids.order} and event_type = 'OrderBecameActionable.v1'`,
    ).toEqual([{ count: 0 }]);
    expect(
      await sql`select reason_code as "reasonCode" from payment_attempt_audits where attempt_id = ${attempt.attemptId} order by occurred_at desc limit 1`,
    ).toEqual([{ reasonCode: "PAID_STOCK_CONFLICT" }]);
    expect(
      await sql`select kind, status from payment_operational_alerts where attempt_id = ${attempt.attemptId}`,
    ).toEqual([{ kind: "PAID_STOCK_CONFLICT", status: "OPEN" }]);
    expect(await service.listReviewRequired()).toMatchObject([
      {
        attempt: { attemptId: attempt.attemptId, status: "CONFIRMED" },
        reviewKind: "PAID_STOCK_CONFLICT",
        alertKinds: ["PAID_STOCK_CONFLICT"],
      },
    ]);
  });

  it("rejects a callback amount mismatch and leaves an operational audit", async () => {
    const attempt = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "amount-mismatch",
      correlationId: "3609f906-c921-490c-a793-84398fb67e0c",
    });

    await expect(
      service.applyCallback(
        provider.successCallback({
          attemptId: attempt.attemptId,
          orderId: ids.order,
          amount: 4_400_000,
          providerEventId: "dev-wrong-amount",
        }),
        "3609f906-c921-490c-a793-84398fb67e0c",
      ),
    ).resolves.toMatchObject({ status: "REVIEW_REQUIRED", duplicate: false });
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PAYMENT_REVIEW" },
    ]);
    expect(
      await sql`select reason_code as "reasonCode" from payment_attempt_audits where attempt_id = ${attempt.attemptId} order by occurred_at desc limit 1`,
    ).toEqual([{ reasonCode: "PROVIDER_AMOUNT_MISMATCH" }]);
    expect(
      await sql`select kind, status from payment_operational_alerts where attempt_id = ${attempt.attemptId}`,
    ).toEqual([{ kind: "PROVIDER_AMOUNT_MISMATCH", status: "OPEN" }]);
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
    expect(
      await sql`select kind, status from payment_operational_alerts where attempt_id = ${attempt.attemptId}`,
    ).toEqual([{ kind: "PROVIDER_AMOUNT_MISMATCH", status: "OPEN" }]);
    expect(await service.listReviewRequired()).toMatchObject([
      {
        attempt: { attemptId: attempt.attemptId, status: "CONFIRMED" },
        reviewKind: "PROVIDER_CONFLICT",
        alertKinds: ["PROVIDER_AMOUNT_MISMATCH"],
      },
    ]);
  });

  it("keeps a terminal failure stable and alerts on a later contradictory success", async () => {
    const attempt = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "contradiction-after-failure",
      correlationId: "browser-contradiction",
    });
    await service.applyCallback(
      provider.callback({
        attemptId: attempt.attemptId,
        orderId: ids.order,
        amount: 4_500_000,
        result: "FAILED",
        providerEventId: "dev-definitive-failure",
      }),
      "browser-contradiction",
    );

    await expect(
      service.applyCallback(
        provider.successCallback({
          attemptId: attempt.attemptId,
          orderId: ids.order,
          amount: 4_500_000,
          providerEventId: "dev-late-contradiction",
        }),
        "browser-contradiction",
      ),
    ).resolves.toMatchObject({ status: "FAILED", duplicate: false });
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PAYMENT_REVIEW" },
    ]);
    expect(
      await sql`select status, payment_attempt_id as "attemptId" from inventory_reservations where id = ${ids.reservation}`,
    ).toEqual([{ status: "HELD_FOR_REVIEW", attemptId: attempt.attemptId }]);
    expect(
      await sql`select kind, status from payment_operational_alerts where attempt_id = ${attempt.attemptId}`,
    ).toEqual([{ kind: "PROVIDER_RESULT_CONTRADICTION", status: "OPEN" }]);
    expect(await service.listReviewRequired()).toMatchObject([
      {
        attempt: { status: "FAILED" },
        reviewKind: "PROVIDER_CONFLICT",
        alertKinds: ["PROVIDER_RESULT_CONTRADICTION"],
      },
    ]);
    await expect(
      service.createAttempt({
        identityId: ids.buyer as never,
        orderId: ids.order as never,
        idempotencyKey: "blocked-after-contradiction",
        correlationId: "browser-contradiction",
      }),
    ).rejects.toThrow();
  });

  it("persists review evidence before rejecting a reused provider event with a different result", async () => {
    const attempt = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "reused-provider-event-result",
      correlationId: "browser-reused-provider-event",
    });
    const providerEventId = "dev-reused-result";
    await service.applyCallback(
      provider.callback({
        attemptId: attempt.attemptId,
        orderId: ids.order,
        amount: 4_500_000,
        result: "FAILED",
        providerEventId,
      }),
      "browser-reused-provider-event",
    );

    await expect(
      service.applyCallback(
        provider.successCallback({
          attemptId: attempt.attemptId,
          orderId: ids.order,
          amount: 4_500_000,
          providerEventId,
        }),
        "browser-reused-provider-event",
      ),
    ).rejects.toBeInstanceOf(DirectPaymentAttemptNotFoundError);
    expect(await sql`select status from order_orders where id = ${ids.order}`).toEqual([
      { status: "PAYMENT_REVIEW" },
    ]);
    expect(
      await sql`select count(*)::int as count from payment_provider_observations where provider_event_id = ${providerEventId}`,
    ).toEqual([{ count: 1 }]);
    expect(
      await sql`select kind, status from payment_operational_alerts where attempt_id = ${attempt.attemptId}`,
    ).toEqual([{ kind: "PROVIDER_RESULT_CONTRADICTION", status: "OPEN" }]);
    expect(
      await sql`select reason_code as "reasonCode" from payment_attempt_audits where attempt_id = ${attempt.attemptId} order by occurred_at desc limit 1`,
    ).toEqual([{ reasonCode: "PROVIDER_RESULT_CONTRADICTS_FAILED" }]);
  });

  it("raises one durable alert when reconciliation remains unresolved for thirty minutes", async () => {
    const attempt = await service.createAttempt({
      identityId: ids.buyer as never,
      orderId: ids.order as never,
      idempotencyKey: "overdue-review",
      correlationId: "5609f906-c921-490c-a793-84398fb67e0c",
    });
    await service.applyCallback(
      provider.callback({
        attemptId: attempt.attemptId,
        orderId: ids.order,
        amount: 4_500_000,
        result: "PENDING",
        providerEventId: "dev-overdue-pending",
      }),
      "5609f906-c921-490c-a793-84398fb67e0c",
    );
    await sql`
      update payment_attempts
      set review_started_at = now() - interval '31 minutes',
        next_reconciliation_at = now() - interval '1 second'
      where id = ${attempt.attemptId}
    `;

    expect(
      await service.reconcileNext(new Date(), "6609f906-c921-490c-a793-84398fb67e0c"),
    ).toBe(true);
    expect(
      await sql`select kind, status from payment_operational_alerts where attempt_id = ${attempt.attemptId}`,
    ).toEqual([{ kind: "RECONCILIATION_OVERDUE", status: "OPEN" }]);
    expect(await service.listReviewRequired()).toMatchObject([
      { alertKinds: ["RECONCILIATION_OVERDUE"] },
    ]);
  });
});
