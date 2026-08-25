import { randomUUID } from "node:crypto";

import {
  directPaymentAttemptCreatedV1Contract,
  directPaymentAttemptDispatchedV1Contract,
  directPaymentAttemptReviewRequiredV1Contract,
  directPaymentAttemptConfirmedV1Contract,
  directPaymentAttemptContract,
} from "@sevo/contracts/payments/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import { paymentAttemptIdContract } from "@sevo/contracts/platform/v1";
import postgres, { type Sql } from "postgres";

import { eventCorrelationId } from "../../../event-correlation-id";
import type {
  InventoryAuthoring,
  InventoryTransactionContext,
} from "../../inventory/public";
import {
  createOrderPaymentTransactionContext,
  type OrderPaymentWorkflow,
} from "../../orders/public";
import {
  DirectPaymentAmountMismatchError,
  DirectPaymentAttemptNotFoundError,
  DirectPaymentIdempotencyConflictError,
  DirectPaymentOrderNotPayableError,
  type DirectPaymentRepository,
} from "../public";

type AttemptRow = {
  attemptId: string;
  orderId: string;
  status: "CREATED" | "DISPATCHED" | "CONFIRMED" | "FAILED" | "REVIEW_REQUIRED";
  amount: number;
  provider: string;
  providerReference: string | null;
  redirectUrl: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  dispatchLeaseUntil: Date | null;
};

export class PostgresDirectPaymentRepository implements DirectPaymentRepository {
  readonly #sql: Sql;

  constructor(
    databaseUrl: string,
    private readonly inventory: InventoryAuthoring,
    private readonly orders: OrderPaymentWorkflow,
    private readonly providerKey: string,
  ) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async prepareAttempt(
    command: Parameters<DirectPaymentRepository["prepareAttempt"]>[0],
  ) {
    return this.#sql.begin(async (sql) => {
      const replay = await sql<Array<{ requestHash: string; attemptId: string }>>`
        select request_hash as "requestHash", attempt_id as "attemptId"
        from payment_idempotency_records
        where identity_id = ${command.identityId}::uuid and key = ${command.idempotencyKey}
      `;
      if (replay[0]) {
        if (replay[0].requestHash !== command.requestHash) {
          throw new DirectPaymentIdempotencyConflictError();
        }
        const existing = await readAttempt(sql, replay[0].attemptId);
        if (!existing) throw new DirectPaymentAttemptNotFoundError();
        if (
          existing.status === "DISPATCHED" &&
          !existing.redirectUrl &&
          existing.dispatchLeaseUntil &&
          existing.dispatchLeaseUntil.getTime() <= Date.now()
        ) {
          const payableOrder = await this.orders.lockPaymentOrder(
            createOrderPaymentTransactionContext(sql),
            command.identityId,
            command.orderId,
          );
          if (!payableOrder || payableOrder.status !== "PENDING_PAYMENT") {
            throw new DirectPaymentOrderNotPayableError();
          }
          const occurredAt = new Date();
          await this.inventory.holdReservationForReview(
            sql as unknown as InventoryTransactionContext,
            {
              reservationId: payableOrder.reservationId,
              attemptId: existing.attemptId,
            },
          );
          await this.orders.markPaymentReview(
            createOrderPaymentTransactionContext(sql),
            {
              orderId: command.orderId,
              attemptId: paymentAttemptIdContract.parse(existing.attemptId),
              occurredAt,
              correlationId: eventCorrelationId(command.correlationId),
              reasonCode: "PAYMENT_DISPATCH_UNRESOLVED",
            },
          );
          await sql`
            update payment_attempts set status = 'REVIEW_REQUIRED'
            where id = ${existing.attemptId} and status = 'DISPATCHED'
              and redirect_url is null
          `;
          await insertAttemptAudit(sql, {
            attemptId: existing.attemptId,
            fromStatus: "DISPATCHED",
            toStatus: "REVIEW_REQUIRED",
            reasonCode: "DISPATCH_LEASE_EXPIRED",
            correlationId: command.correlationId,
          });
          existing.status = "REVIEW_REQUIRED";
          await enqueueOutboxEvent(
            sql,
            directPaymentAttemptReviewRequiredV1Contract.parse({
              eventId: randomUUID(),
              version: 1,
              eventType: "DirectPaymentAttemptReviewRequired.v1",
              aggregateId: existing.attemptId,
              aggregateVersion: 3,
              occurredAt: occurredAt.toISOString(),
              correlationId: eventCorrelationId(command.correlationId),
              causationId: existing.attemptId,
              actor: { type: "SYSTEM" },
              payload: { status: "REVIEW_REQUIRED" },
            }),
          );
        }
        return mapAttempt(existing);
      }
      const order = await this.orders.lockPaymentOrder(
        createOrderPaymentTransactionContext(sql),
        command.identityId,
        command.orderId,
      );
      if (
        !order ||
        order.status !== "PENDING_PAYMENT" ||
        order.reservationExpiresAt.getTime() <= Date.now()
      ) {
        throw new DirectPaymentOrderNotPayableError();
      }
      const active = await sql<AttemptRow[]>`
        select id as "attemptId", order_id as "orderId", status,
          amount::int as amount, provider,
          provider_reference as "providerReference", redirect_url as "redirectUrl",
          created_at as "createdAt", confirmed_at as "confirmedAt",
          dispatch_lease_until as "dispatchLeaseUntil"
        from payment_attempts
        where order_id = ${order.orderId}::uuid
          and status in ('CREATED', 'DISPATCHED', 'CONFIRMED')
        for update
      `;
      if (active[0]) return mapAttempt(active[0]);
      await sql`
        insert into payment_attempts
          (id, order_id, identity_id, status, amount, currency, provider)
        values
          (${command.attemptId}, ${order.orderId}, ${command.identityId}, 'CREATED',
           ${order.totalAmount}, 'IRR', ${this.providerKey})
      `;
      await this.inventory.holdReservationForPayment(
        sql as unknown as InventoryTransactionContext,
        {
          reservationId: order.reservationId,
          attemptId: command.attemptId,
          leaseUntil: command.leaseUntil,
          now: new Date(),
        },
      );
      await insertAttemptAudit(sql, {
        attemptId: command.attemptId,
        fromStatus: null,
        toStatus: "CREATED",
        reasonCode: "PAYMENT_ATTEMPT_CREATED",
        correlationId: command.correlationId,
      });
      await enqueueOutboxEvent(
        sql,
        directPaymentAttemptCreatedV1Contract.parse({
          eventId: randomUUID(),
          version: 1,
          eventType: "DirectPaymentAttemptCreated.v1",
          aggregateId: command.attemptId,
          aggregateVersion: 1,
          occurredAt: new Date().toISOString(),
          correlationId: eventCorrelationId(command.correlationId),
          causationId: command.attemptId,
          actor: { type: "IDENTITY", id: command.identityId },
          payload: {
            status: "CREATED",
            amount: { amount: order.totalAmount, currency: "IRR" },
          },
        }),
      );
      await sql`
        insert into payment_idempotency_records
          (identity_id, key, request_hash, attempt_id)
        values
          (${command.identityId}, ${command.idempotencyKey}, ${command.requestHash},
           ${command.attemptId})
      `;
      return mapAttempt((await readAttempt(sql, command.attemptId))!);
    });
  }

  async claimDispatch(
    attemptId: Parameters<DirectPaymentRepository["claimDispatch"]>[0],
    correlationId: string,
  ) {
    return this.#sql.begin(async (sql) => {
      const rows = await sql<Array<{ attemptId: string; amount: number }>>`
        update payment_attempts
        set status = 'DISPATCHED', dispatched_at = now(),
          dispatch_lease_until = now() + interval '30 seconds'
        where id = ${attemptId}::uuid and status = 'CREATED'
        returning id as "attemptId", amount::int as amount
      `;
      if (!rows[0]) return false;
      await insertAttemptAudit(sql, {
        attemptId,
        fromStatus: "CREATED",
        toStatus: "DISPATCHED",
        reasonCode: "PROVIDER_DISPATCH_CLAIMED",
        correlationId,
      });
      await enqueueOutboxEvent(
        sql,
        directPaymentAttemptDispatchedV1Contract.parse({
          eventId: randomUUID(),
          version: 1,
          eventType: "DirectPaymentAttemptDispatched.v1",
          aggregateId: attemptId,
          aggregateVersion: 2,
          occurredAt: new Date().toISOString(),
          correlationId: eventCorrelationId(correlationId),
          causationId: attemptId,
          actor: { type: "SYSTEM" },
          payload: { status: "DISPATCHED" },
        }),
      );
      return true;
    });
  }

  async recordInitiation(
    command: Parameters<DirectPaymentRepository["recordInitiation"]>[0],
  ) {
    const rows = await this.#sql<AttemptRow[]>`
      update payment_attempts
      set provider_reference = ${command.providerReference},
        redirect_url = ${command.redirectUrl}
      where id = ${command.attemptId}::uuid and status = 'DISPATCHED'
      returning id as "attemptId", order_id as "orderId", status,
        amount::int as amount, provider,
        provider_reference as "providerReference", redirect_url as "redirectUrl",
        created_at as "createdAt", confirmed_at as "confirmedAt",
        dispatch_lease_until as "dispatchLeaseUntil"
    `;
    if (!rows[0]) throw new DirectPaymentAttemptNotFoundError();
    return mapAttempt(rows[0]);
  }

  async confirmCallback(
    callback: Parameters<DirectPaymentRepository["confirmCallback"]>[0],
    correlationId: string,
  ) {
    return this.#sql.begin(async (sql) => {
      const attempts = await sql<Array<AttemptRow & { identityId: string }>>`
        select attempt.id as "attemptId", attempt.order_id as "orderId",
          attempt.status, attempt.amount::int as amount, attempt.provider,
          attempt.provider_reference as "providerReference",
          attempt.redirect_url as "redirectUrl", attempt.created_at as "createdAt",
          attempt.confirmed_at as "confirmedAt", attempt.identity_id as "identityId",
          attempt.dispatch_lease_until as "dispatchLeaseUntil"
        from payment_attempts attempt
        where attempt.id = ${callback.attemptId}::uuid
        for update
      `;
      const attempt = attempts[0];
      if (
        !attempt ||
        attempt.orderId !== callback.orderId ||
        attempt.providerReference !== callback.providerReference
      ) {
        throw new DirectPaymentAttemptNotFoundError();
      }
      if (attempt.amount !== callback.amount) {
        throw new DirectPaymentAmountMismatchError();
      }
      const observation = await sql<Array<{ eventId: string }>>`
        insert into payment_provider_observations
          (provider, provider_event_id, attempt_id, provider_reference, result,
           correlation_id)
        values
          (${this.providerKey}, ${callback.providerEventId}, ${attempt.attemptId},
           ${callback.providerReference}, 'CONFIRMED', ${correlationId})
        on conflict (provider, provider_event_id) do nothing
        returning provider_event_id as "eventId"
      `;
      if (!observation[0]) {
        const original = await sql<Array<{ attemptId: string }>>`
          select attempt_id as "attemptId"
          from payment_provider_observations
          where provider = ${this.providerKey} and provider_event_id = ${callback.providerEventId}
        `;
        if (original[0]?.attemptId !== attempt.attemptId) {
          throw new DirectPaymentAttemptNotFoundError();
        }
        if (attempt.status !== "CONFIRMED") {
          throw new DirectPaymentOrderNotPayableError();
        }
        return {
          attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
          status: "CONFIRMED" as const,
          duplicate: true,
        };
      }
      if (attempt.status === "CONFIRMED") {
        return {
          attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
          status: "CONFIRMED" as const,
          duplicate: true,
        };
      }
      const order = await this.orders.lockPaymentOrder(
        createOrderPaymentTransactionContext(sql),
        attempt.identityId as Parameters<OrderPaymentWorkflow["lockPaymentOrder"]>[1],
        attempt.orderId as Parameters<OrderPaymentWorkflow["lockPaymentOrder"]>[2],
      );
      if (!order) throw new DirectPaymentOrderNotPayableError();
      if (order.totalAmount !== callback.amount) {
        throw new DirectPaymentAmountMismatchError();
      }
      const now = new Date();
      if (order.status === "PENDING_PAYMENT" || order.status === "PAYMENT_REVIEW") {
        await this.inventory.consumeReservation(
          sql as unknown as InventoryTransactionContext,
          { reservationId: order.reservationId, attemptId: attempt.attemptId },
        );
        await this.orders.markPaid(createOrderPaymentTransactionContext(sql), {
          orderId: attempt.orderId as Parameters<
            OrderPaymentWorkflow["markPaid"]
          >[1]["orderId"],
          attemptId: attempt.attemptId as Parameters<
            OrderPaymentWorkflow["markPaid"]
          >[1]["attemptId"],
          paidAt: now,
          correlationId: eventCorrelationId(correlationId),
        });
      } else if (order.status === "EXPIRED") {
        await this.orders.markPaymentReview(createOrderPaymentTransactionContext(sql), {
          orderId: attempt.orderId as Parameters<
            OrderPaymentWorkflow["markPaymentReview"]
          >[1]["orderId"],
          attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
          occurredAt: now,
          correlationId: eventCorrelationId(correlationId),
          reasonCode: "PAYMENT_CONFIRMED_STOCK_CONFLICT",
        });
      } else {
        throw new DirectPaymentOrderNotPayableError();
      }
      await sql`update payment_attempts set status = 'CONFIRMED', confirmed_at = ${now} where id = ${attempt.attemptId}`;
      await insertAttemptAudit(sql, {
        attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
        fromStatus: attempt.status,
        toStatus: "CONFIRMED",
        reasonCode: "PROVIDER_CONFIRMED",
        correlationId,
      });
      await enqueueOutboxEvent(
        sql,
        directPaymentAttemptConfirmedV1Contract.parse({
          eventId: randomUUID(),
          version: 1,
          eventType: "DirectPaymentAttemptConfirmed.v1",
          aggregateId: attempt.attemptId,
          aggregateVersion: 3,
          occurredAt: now.toISOString(),
          correlationId: eventCorrelationId(correlationId),
          causationId: attempt.attemptId,
          actor: { type: "SYSTEM" },
          payload: {
            status: "CONFIRMED",
            amount: { amount: attempt.amount, currency: "IRR" },
          },
        }),
      );
      return {
        attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
        status: "CONFIRMED" as const,
        duplicate: false,
      };
    });
  }

  async recoverExpiredDispatches(now: Date) {
    return this.#sql.begin(async (sql) => {
      const rows = await sql<
        Array<{
          attemptId: string;
          orderId: string;
          identityId: string;
          reservationId: string;
        }>
      >`
        select attempt.id as "attemptId", attempt.order_id as "orderId",
          attempt.identity_id as "identityId", orders.reservation_id as "reservationId"
        from payment_attempts attempt
        join order_orders orders on orders.id = attempt.order_id
        where attempt.status = 'DISPATCHED'
          and attempt.dispatch_lease_until <= ${now}
          and orders.status = 'PENDING_PAYMENT'
        order by attempt.dispatch_lease_until, attempt.id
        for update of attempt skip locked
        limit 100
      `;
      let recovered = 0;
      for (const row of rows) {
        const correlationId = randomUUID();
        const order = await this.orders.lockPaymentOrder(
          createOrderPaymentTransactionContext(sql),
          row.identityId as Parameters<OrderPaymentWorkflow["lockPaymentOrder"]>[1],
          row.orderId as Parameters<OrderPaymentWorkflow["lockPaymentOrder"]>[2],
        );
        if (!order || order.status !== "PENDING_PAYMENT") continue;
        await this.inventory.holdReservationForReview(
          sql as unknown as InventoryTransactionContext,
          { reservationId: row.reservationId, attemptId: row.attemptId },
        );
        const occurredAt = new Date();
        await this.orders.markPaymentReview(createOrderPaymentTransactionContext(sql), {
          orderId: row.orderId as Parameters<
            OrderPaymentWorkflow["markPaymentReview"]
          >[1]["orderId"],
          attemptId: paymentAttemptIdContract.parse(row.attemptId),
          occurredAt,
          correlationId,
          reasonCode: "PAYMENT_DISPATCH_UNRESOLVED",
        });
        await sql`
          update payment_attempts set status = 'REVIEW_REQUIRED'
          where id = ${row.attemptId} and status = 'DISPATCHED'
        `;
        await insertAttemptAudit(sql, {
          attemptId: row.attemptId,
          fromStatus: "DISPATCHED",
          toStatus: "REVIEW_REQUIRED",
          reasonCode: "DISPATCH_LEASE_EXPIRED",
          correlationId,
        });
        await enqueueOutboxEvent(
          sql,
          directPaymentAttemptReviewRequiredV1Contract.parse({
            eventId: randomUUID(),
            version: 1,
            eventType: "DirectPaymentAttemptReviewRequired.v1",
            aggregateId: row.attemptId,
            aggregateVersion: 3,
            occurredAt: occurredAt.toISOString(),
            correlationId,
            causationId: row.attemptId,
            actor: { type: "SYSTEM" },
            payload: { status: "REVIEW_REQUIRED" },
          }),
        );
        recovered += 1;
      }
      return recovered;
    });
  }

  async readAttemptForBuyer(
    identityId: Parameters<DirectPaymentRepository["readAttemptForBuyer"]>[0],
    attemptId: Parameters<DirectPaymentRepository["readAttemptForBuyer"]>[1],
  ) {
    const rows = await this.#sql<AttemptRow[]>`
      select id as "attemptId", order_id as "orderId", status,
        amount::int as amount, provider,
        provider_reference as "providerReference", redirect_url as "redirectUrl",
        created_at as "createdAt", confirmed_at as "confirmedAt",
        dispatch_lease_until as "dispatchLeaseUntil"
      from payment_attempts
      where id = ${attemptId}::uuid and identity_id = ${identityId}::uuid
    `;
    return rows[0] ? mapAttempt(rows[0]) : undefined;
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

async function insertAttemptAudit(
  sql: Sql,
  input: {
    attemptId: string;
    fromStatus: string | null;
    toStatus: string;
    reasonCode: string;
    correlationId: string;
  },
) {
  await sql`
    insert into payment_attempt_audits
      (id, attempt_id, from_status, to_status, reason_code, actor_kind,
       correlation_id)
    values
      (${randomUUID()}, ${input.attemptId}, ${input.fromStatus}, ${input.toStatus},
       ${input.reasonCode}, 'PAYMENTS_SERVICE', ${input.correlationId})
  `;
}

async function readAttempt(sql: Sql, attemptId: string) {
  const rows = await sql<AttemptRow[]>`
    select id as "attemptId", order_id as "orderId", status,
      amount::int as amount, provider,
      provider_reference as "providerReference", redirect_url as "redirectUrl",
      created_at as "createdAt", confirmed_at as "confirmedAt",
      dispatch_lease_until as "dispatchLeaseUntil"
    from payment_attempts where id = ${attemptId}::uuid
    for update
  `;
  return rows[0];
}

function mapAttempt(row: AttemptRow) {
  return directPaymentAttemptContract.parse({
    attemptId: row.attemptId,
    orderId: row.orderId,
    status: row.status,
    amount: { amount: row.amount, currency: "IRR" },
    provider: row.provider,
    ...(row.providerReference ? { providerReference: row.providerReference } : {}),
    ...(row.redirectUrl ? { redirectUrl: row.redirectUrl } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.toISOString() } : {}),
  });
}
