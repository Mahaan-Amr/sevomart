import { randomUUID } from "node:crypto";

import {
  directPaymentAttemptCreatedV1Contract,
  directPaymentAttemptDispatchedV1Contract,
  directPaymentAttemptFailedV1Contract,
  directPaymentAttemptReviewRequiredV1Contract,
  directPaymentAttemptConfirmedV1Contract,
  directPaymentAttemptContract,
  type DirectPaymentAttemptStatus,
  type PaymentAttemptAuditReasonCode,
} from "@sevo/contracts/payments/v1";
import {
  paymentReviewDetailV2Contract,
  paymentReviewItemV2Contract,
} from "@sevo/contracts/payments/v2";
import { enqueueOutboxEvent } from "@sevo/outbox";
import { paymentAttemptIdContract } from "@sevo/contracts/platform/v1";
import postgres, { type Sql } from "postgres";

import { eventCorrelationId } from "../../../event-correlation-id";
import type {
  OpaquePlatformAccessTransactionContext,
  PlatformSensitiveAccess,
} from "../../identity-access/public";
import type {
  InventoryAuthoring,
  InventoryTransactionContext,
} from "../../inventory/public";
import {
  createOrderPaymentTransactionContext,
  type BuyerPaymentState,
  type OrderPaymentWorkflow,
} from "../../orders/public";
import {
  DirectPaymentAmountMismatchError,
  DirectPaymentAttemptNotFoundError,
  DirectPaymentIdempotencyConflictError,
  DirectPaymentOrderNotPayableError,
  PaymentReconciliationNotAvailableError,
  PaymentReviewNotFoundError,
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
    private readonly sensitiveAccess?: PlatformSensitiveAccess,
    private readonly createAccessTransactionContext?: (
      transaction: Sql,
    ) => OpaquePlatformAccessTransactionContext,
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
          await this.#transitionToReview(sql, {
            attemptId: existing.attemptId,
            orderId: command.orderId,
            reservationId: payableOrder.reservationId,
            reasonCode: "DISPATCH_LEASE_EXPIRED",
            correlationId: command.correlationId,
            occurredAt,
          });
          existing.status = "REVIEW_REQUIRED";
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
          (id, order_id, identity_id, status, amount, currency, provider,
           dispatch_lease_until)
        values
          (${command.attemptId}, ${order.orderId}, ${command.identityId}, 'CREATED',
           ${order.totalAmount}, 'IRR', ${this.providerKey}, ${command.leaseUntil})
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
    return this.#sql.begin(async (sql) => {
      const rows = await sql<AttemptRow[]>`
        update payment_attempts
        set provider_reference = coalesce(provider_reference, ${command.providerReference}),
          redirect_url = coalesce(redirect_url, ${command.redirectUrl})
        where id = ${command.attemptId}::uuid
          and status in ('DISPATCHED', 'REVIEW_REQUIRED')
          and (provider_reference is null or provider_reference = ${command.providerReference})
        returning id as "attemptId", order_id as "orderId", status,
          amount::int as amount, provider,
          provider_reference as "providerReference", redirect_url as "redirectUrl",
          created_at as "createdAt", confirmed_at as "confirmedAt",
          dispatch_lease_until as "dispatchLeaseUntil"
      `;
      const attempt = rows[0];
      if (!attempt) throw new DirectPaymentAttemptNotFoundError();
      if (attempt.status === "REVIEW_REQUIRED") {
        await insertAttemptAudit(sql, {
          attemptId: attempt.attemptId,
          fromStatus: "REVIEW_REQUIRED",
          toStatus: "REVIEW_REQUIRED",
          reasonCode: "PROVIDER_REFERENCE_RECOVERED",
          correlationId: command.correlationId,
        });
      }
      return mapAttempt(attempt);
    });
  }

  async applyProviderResult(
    callback: Parameters<DirectPaymentRepository["applyProviderResult"]>[0],
    correlationId: string,
  ) {
    const outcome = await this.#sql.begin(async (sql) => {
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
        !(callback.acceptedProviderReferences ?? [callback.providerReference]).includes(
          attempt.providerReference ?? "",
        )
      ) {
        throw new DirectPaymentAttemptNotFoundError();
      }
      if (attempt.providerReference !== callback.providerReference) {
        await sql`
          update payment_attempts set provider_reference = ${callback.providerReference}
          where id = ${attempt.attemptId}::uuid
        `;
      }
      const observation = await sql<Array<{ eventId: string }>>`
        insert into payment_provider_observations
          (provider, provider_event_id, attempt_id, provider_reference, result,
           correlation_id)
        values
          (${this.providerKey}, ${callback.providerEventId}, ${attempt.attemptId},
           ${callback.providerReference}, ${callback.result}, ${correlationId})
        on conflict (provider, provider_event_id) do nothing
        returning provider_event_id as "eventId"
      `;
      if (!observation[0]) {
        const original = await sql<Array<{ attemptId: string; result: string }>>`
          select attempt_id as "attemptId", result
          from payment_provider_observations
          where provider = ${this.providerKey} and provider_event_id = ${callback.providerEventId}
        `;
        if (original[0]?.attemptId !== attempt.attemptId) {
          throw new DirectPaymentAttemptNotFoundError();
        }
        if (original[0]?.result !== callback.result) {
          await this.#protectFailedAttemptFromContradictoryResult(
            sql,
            attempt,
            correlationId,
          );
          const occurredAt = new Date();
          await insertAttemptAudit(sql, {
            attemptId: attempt.attemptId,
            fromStatus: attempt.status,
            toStatus: attempt.status,
            reasonCode:
              attempt.status === "CONFIRMED"
                ? "PROVIDER_RESULT_CONTRADICTS_CONFIRMED"
                : attempt.status === "FAILED"
                  ? "PROVIDER_RESULT_CONTRADICTS_FAILED"
                  : "DUPLICATE_PROVIDER_EVENT_RESULT_CONFLICT",
            correlationId,
          });
          await insertOperationalAlert(sql, {
            attemptId: attempt.attemptId,
            kind: "PROVIDER_RESULT_CONTRADICTION",
            correlationId,
            occurredAt,
          });
          return { providerResultConflict: true as const };
        }
        if (attempt.amount !== callback.amount) {
          const occurredAt = new Date();
          await insertAttemptAudit(sql, {
            attemptId: attempt.attemptId,
            fromStatus: attempt.status,
            toStatus: attempt.status,
            reasonCode: "DUPLICATE_PROVIDER_EVENT_AMOUNT_MISMATCH",
            correlationId,
          });
          await insertOperationalAlert(sql, {
            attemptId: attempt.attemptId,
            kind: "PROVIDER_AMOUNT_MISMATCH",
            correlationId,
            occurredAt,
          });
          return { amountMismatch: true as const };
        }
        return {
          attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
          status: attempt.status as "CONFIRMED" | "FAILED" | "REVIEW_REQUIRED",
          duplicate: true,
        };
      }
      if (attempt.amount !== callback.amount) {
        if (attempt.status === "DISPATCHED") {
          const order = await this.orders.lockPaymentResultOrder(
            createOrderPaymentTransactionContext(sql),
            attempt.identityId as Parameters<
              OrderPaymentWorkflow["lockPaymentResultOrder"]
            >[1],
            attempt.orderId as Parameters<
              OrderPaymentWorkflow["lockPaymentResultOrder"]
            >[2],
          );
          if (!order) throw new DirectPaymentOrderNotPayableError();
          const occurredAt = new Date();
          await this.#transitionToReview(sql, {
            attemptId: attempt.attemptId,
            orderId: attempt.orderId as Parameters<
              OrderPaymentWorkflow["markPaymentReview"]
            >[1]["orderId"],
            reservationId: order.reservationId,
            reasonCode: "PROVIDER_AMOUNT_MISMATCH",
            occurredAt,
            correlationId,
          });
          await insertOperationalAlert(sql, {
            attemptId: attempt.attemptId,
            kind: "PROVIDER_AMOUNT_MISMATCH",
            correlationId,
            occurredAt,
          });
          return {
            attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
            status: "REVIEW_REQUIRED" as const,
            duplicate: false,
          };
        }
        await insertAttemptAudit(sql, {
          attemptId: attempt.attemptId,
          fromStatus: attempt.status,
          toStatus: attempt.status,
          reasonCode: "PROVIDER_AMOUNT_MISMATCH",
          correlationId,
        });
        await insertOperationalAlert(sql, {
          attemptId: attempt.attemptId,
          kind: "PROVIDER_AMOUNT_MISMATCH",
          correlationId,
          occurredAt: new Date(),
        });
        return {
          attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
          status: attempt.status as "CONFIRMED" | "FAILED" | "REVIEW_REQUIRED",
          duplicate: false,
        };
      }
      if (attempt.status === "CONFIRMED") {
        if (callback.result !== "CONFIRMED") {
          await insertAttemptAudit(sql, {
            attemptId: attempt.attemptId,
            fromStatus: "CONFIRMED",
            toStatus: "CONFIRMED",
            reasonCode: "PROVIDER_RESULT_CONTRADICTS_CONFIRMED",
            correlationId,
          });
          await insertOperationalAlert(sql, {
            attemptId: attempt.attemptId,
            kind: "PROVIDER_RESULT_CONTRADICTION",
            correlationId,
            occurredAt: new Date(),
          });
        }
        return {
          attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
          status: "CONFIRMED" as const,
          duplicate: true,
        };
      }
      if (attempt.status === "FAILED") {
        if (callback.result !== "FAILED") {
          await this.#protectFailedAttemptFromContradictoryResult(
            sql,
            attempt,
            correlationId,
          );
          await insertAttemptAudit(sql, {
            attemptId: attempt.attemptId,
            fromStatus: "FAILED",
            toStatus: "FAILED",
            reasonCode: "PROVIDER_RESULT_CONTRADICTS_FAILED",
            correlationId,
          });
          await insertOperationalAlert(sql, {
            attemptId: attempt.attemptId,
            kind: "PROVIDER_RESULT_CONTRADICTION",
            correlationId,
            occurredAt: new Date(),
          });
        }
        return {
          attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
          status: "FAILED" as const,
          duplicate: callback.result === "FAILED",
        };
      }
      if (attempt.status === "REVIEW_REQUIRED" && callback.result === "PENDING") {
        return {
          attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
          status: "REVIEW_REQUIRED" as const,
          duplicate: false,
        };
      }
      const order = await this.orders.lockPaymentResultOrder(
        createOrderPaymentTransactionContext(sql),
        attempt.identityId as Parameters<
          OrderPaymentWorkflow["lockPaymentResultOrder"]
        >[1],
        attempt.orderId as Parameters<
          OrderPaymentWorkflow["lockPaymentResultOrder"]
        >[2],
      );
      if (!order) throw new DirectPaymentOrderNotPayableError();
      if (order.totalAmount !== callback.amount) {
        throw new DirectPaymentAmountMismatchError();
      }
      if (callback.result === "FAILED") {
        const now = new Date();
        const reservationStatus = await this.inventory.resolveFailedPayment(
          sql as unknown as InventoryTransactionContext,
          {
            reservationId: order.reservationId,
            attemptId: attempt.attemptId,
            now,
          },
        );
        await sql`
          update payment_attempts set status = 'FAILED'
          where id = ${attempt.attemptId} and status in ('DISPATCHED', 'REVIEW_REQUIRED')
        `;
        await insertAttemptAudit(sql, {
          attemptId: attempt.attemptId,
          fromStatus: attempt.status,
          toStatus: "FAILED",
          reasonCode: "PROVIDER_FAILED",
          correlationId,
        });
        await enqueueAttemptFailed(sql, {
          attemptId: attempt.attemptId,
          amount: attempt.amount,
          occurredAt: now,
          correlationId,
          aggregateVersion: attempt.status === "REVIEW_REQUIRED" ? 4 : 3,
        });
        const orderStatus = await this.orders.resolvePaymentFailure(
          createOrderPaymentTransactionContext(sql),
          {
            orderId: attempt.orderId as Parameters<
              OrderPaymentWorkflow["resolvePaymentFailure"]
            >[1]["orderId"],
            attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
            occurredAt: now,
            correlationId,
          },
        );
        if ((reservationStatus === "RELEASED") !== (orderStatus === "EXPIRED")) {
          throw new Error("Payment failure resolved order and reservation differently");
        }
        return {
          attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
          status: "FAILED" as const,
          duplicate: false,
        };
      }
      if (callback.result === "PENDING") {
        const now = new Date();
        await this.#transitionToReview(sql, {
          attemptId: attempt.attemptId,
          orderId: attempt.orderId as Parameters<
            OrderPaymentWorkflow["markPaymentReview"]
          >[1]["orderId"],
          reservationId: order.reservationId,
          reasonCode: "PROVIDER_RESULT_PENDING",
          correlationId,
          occurredAt: now,
        });
        return {
          attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
          status: "REVIEW_REQUIRED" as const,
          duplicate: false,
        };
      }
      const consumed = await this.inventory.consumeReservation(
        sql as unknown as InventoryTransactionContext,
        { reservationId: order.reservationId, attemptId: attempt.attemptId },
      );
      const now = new Date();
      await sql`update payment_attempts set status = 'CONFIRMED', confirmed_at = ${now} where id = ${attempt.attemptId}`;
      await insertAttemptAudit(sql, {
        attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
        fromStatus: attempt.status,
        toStatus: "CONFIRMED",
        reasonCode: consumed ? "PROVIDER_CONFIRMED" : "PAID_STOCK_CONFLICT",
        correlationId,
      });
      if (consumed) {
        await this.orders.markPaid(createOrderPaymentTransactionContext(sql), {
          orderId: attempt.orderId as Parameters<
            OrderPaymentWorkflow["markPaid"]
          >[1]["orderId"],
          attemptId: attempt.attemptId as Parameters<
            OrderPaymentWorkflow["markPaid"]
          >[1]["attemptId"],
          paidAt: now,
          correlationId,
        });
      } else {
        await this.orders.markPaidStockConflict(
          createOrderPaymentTransactionContext(sql),
          {
            orderId: attempt.orderId as Parameters<
              OrderPaymentWorkflow["markPaidStockConflict"]
            >[1]["orderId"],
            attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
            occurredAt: now,
            correlationId,
          },
        );
        await insertOperationalAlert(sql, {
          attemptId: attempt.attemptId,
          kind: "PAID_STOCK_CONFLICT",
          correlationId,
          occurredAt: now,
        });
      }
      await enqueueOutboxEvent(
        sql,
        directPaymentAttemptConfirmedV1Contract.parse({
          eventId: randomUUID(),
          version: 1,
          eventType: "DirectPaymentAttemptConfirmed.v1",
          aggregateId: attempt.attemptId,
          aggregateVersion: attempt.status === "REVIEW_REQUIRED" ? 4 : 3,
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
    if ("amountMismatch" in outcome) {
      throw new DirectPaymentAmountMismatchError();
    }
    if ("providerResultConflict" in outcome) {
      throw new DirectPaymentAttemptNotFoundError();
    }
    return outcome;
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
    const attempt = rows[0];
    if (!attempt) return undefined;
    const order = await this.orders.readBuyerPaymentState(
      identityId,
      attempt.orderId as Parameters<OrderPaymentWorkflow["readBuyerPaymentState"]>[1],
    );
    if (!order) throw new DirectPaymentAttemptNotFoundError();
    return mapAttempt(attempt, order);
  }

  async recoverExpiredAttempts(now: Date, correlationId: string) {
    return this.#sql.begin(async (sql) => {
      const rows = await sql<Array<AttemptRow & { identityId: string }>>`
        select attempt.id as "attemptId", attempt.order_id as "orderId",
          attempt.identity_id as "identityId", attempt.status,
          attempt.amount::int as amount, attempt.provider,
          attempt.provider_reference as "providerReference",
          attempt.redirect_url as "redirectUrl", attempt.created_at as "createdAt",
          attempt.confirmed_at as "confirmedAt",
          attempt.dispatch_lease_until as "dispatchLeaseUntil"
        from payment_attempts attempt
        where attempt.status in ('CREATED', 'DISPATCHED')
          and attempt.dispatch_lease_until <= ${now}
        order by attempt.dispatch_lease_until, attempt.id
        for update skip locked
        limit 100
      `;
      for (const attempt of rows) {
        const order = await this.orders.lockPaymentResultOrder(
          createOrderPaymentTransactionContext(sql),
          attempt.identityId as Parameters<
            OrderPaymentWorkflow["lockPaymentResultOrder"]
          >[1],
          attempt.orderId as Parameters<
            OrderPaymentWorkflow["lockPaymentResultOrder"]
          >[2],
        );
        if (!order) throw new DirectPaymentOrderNotPayableError();
        if (attempt.status === "CREATED") {
          const reservationStatus = await this.inventory.resolveFailedPayment(
            sql as unknown as InventoryTransactionContext,
            {
              reservationId: order.reservationId,
              attemptId: attempt.attemptId,
              now,
            },
          );
          await sql`
            update payment_attempts set status = 'FAILED'
            where id = ${attempt.attemptId} and status = 'CREATED'
          `;
          await insertAttemptAudit(sql, {
            attemptId: attempt.attemptId,
            fromStatus: "CREATED",
            toStatus: "FAILED",
            reasonCode: "DISPATCH_NOT_STARTED_BEFORE_LEASE_EXPIRY",
            correlationId,
          });
          await enqueueAttemptFailed(sql, {
            attemptId: attempt.attemptId,
            amount: attempt.amount,
            occurredAt: now,
            correlationId,
            aggregateVersion: 2,
          });
          const orderStatus = await this.orders.resolvePaymentFailure(
            createOrderPaymentTransactionContext(sql),
            {
              orderId: attempt.orderId as Parameters<
                OrderPaymentWorkflow["resolvePaymentFailure"]
              >[1]["orderId"],
              attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
              occurredAt: now,
              correlationId,
            },
          );
          if ((reservationStatus === "RELEASED") !== (orderStatus === "EXPIRED")) {
            throw new Error(
              "Undispatched recovery resolved order and reservation differently",
            );
          }
          continue;
        }
        const occurredAt = new Date(now);
        await this.#transitionToReview(sql, {
          attemptId: attempt.attemptId,
          orderId: attempt.orderId as Parameters<
            OrderPaymentWorkflow["markPaymentReview"]
          >[1]["orderId"],
          reservationId: order.reservationId,
          reasonCode: "DISPATCH_LEASE_EXPIRED",
          correlationId,
          occurredAt,
        });
      }
      return rows.length;
    });
  }

  async markDispatchUnknown(
    attemptId: Parameters<DirectPaymentRepository["markDispatchUnknown"]>[0],
    correlationId: string,
  ) {
    return this.#sql.begin(async (sql) => {
      const rows = await sql<Array<AttemptRow & { identityId: string }>>`
        select attempt.id as "attemptId", attempt.order_id as "orderId",
          attempt.identity_id as "identityId", attempt.status,
          attempt.amount::int as amount, attempt.provider,
          attempt.provider_reference as "providerReference",
          attempt.redirect_url as "redirectUrl", attempt.created_at as "createdAt",
          attempt.confirmed_at as "confirmedAt",
          attempt.dispatch_lease_until as "dispatchLeaseUntil"
        from payment_attempts attempt
        where attempt.id = ${attemptId} and attempt.status = 'DISPATCHED'
        for update
      `;
      const attempt = rows[0];
      if (!attempt) throw new DirectPaymentAttemptNotFoundError();
      const order = await this.orders.lockPaymentResultOrder(
        createOrderPaymentTransactionContext(sql),
        attempt.identityId as Parameters<
          OrderPaymentWorkflow["lockPaymentResultOrder"]
        >[1],
        attempt.orderId as Parameters<
          OrderPaymentWorkflow["lockPaymentResultOrder"]
        >[2],
      );
      if (!order) throw new DirectPaymentOrderNotPayableError();
      const occurredAt = new Date();
      await this.#transitionToReview(sql, {
        attemptId: attempt.attemptId,
        orderId: attempt.orderId as Parameters<
          OrderPaymentWorkflow["markPaymentReview"]
        >[1]["orderId"],
        reservationId: order.reservationId,
        reasonCode: "PROVIDER_INITIATION_OUTCOME_UNKNOWN",
        correlationId,
        occurredAt,
      });
      attempt.status = "REVIEW_REQUIRED";
      return mapAttempt(attempt);
    });
  }

  async claimNextReconciliation(now: Date, correlationId: string) {
    return this.#sql.begin(async (sql) => {
      await sql`
        insert into payment_operational_alerts
          (id, attempt_id, kind, severity, status, correlation_id, created_at)
        select
          (
            substr(md5(attempt.id::text || ':RECONCILIATION_OVERDUE'), 1, 8) || '-' ||
            substr(md5(attempt.id::text || ':RECONCILIATION_OVERDUE'), 9, 4) || '-' ||
            substr(md5(attempt.id::text || ':RECONCILIATION_OVERDUE'), 13, 4) || '-' ||
            substr(md5(attempt.id::text || ':RECONCILIATION_OVERDUE'), 17, 4) || '-' ||
            substr(md5(attempt.id::text || ':RECONCILIATION_OVERDUE'), 21, 12)
          )::uuid,
          attempt.id, 'RECONCILIATION_OVERDUE', 'CRITICAL', 'OPEN',
          ${correlationId}, ${now}
        from payment_attempts attempt
        where attempt.status = 'REVIEW_REQUIRED'
          and attempt.review_started_at <= ${new Date(now.getTime() - 30 * 60_000)}
        on conflict (attempt_id, kind) do nothing
      `;
      const rows = await sql<
        Array<{
          attemptId: string;
          orderId: string;
          amount: number;
          providerReference: string | null;
          reconciliationCount: number;
        }>
      >`
        select id as "attemptId", order_id as "orderId", amount::int as amount,
          provider_reference as "providerReference",
          reconciliation_count as "reconciliationCount"
        from payment_attempts
        where status = 'REVIEW_REQUIRED' and next_reconciliation_at <= ${now}
        order by next_reconciliation_at, id
        for update skip locked
        limit 1
      `;
      const attempt = rows[0];
      if (!attempt) return null;
      const delayMs = reconciliationDelayMs(attempt.reconciliationCount);
      await sql`
        update payment_attempts
        set reconciliation_count = reconciliation_count + 1,
          next_reconciliation_at = ${new Date(now.getTime() + delayMs)}
        where id = ${attempt.attemptId}
      `;
      return {
        attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
        orderId: attempt.orderId as Parameters<
          DirectPaymentRepository["prepareAttempt"]
        >[0]["orderId"],
        amount: { amount: attempt.amount, currency: "IRR" as const },
        ...(attempt.providerReference
          ? { providerReference: attempt.providerReference }
          : {}),
      };
    });
  }

  async listReviewRequiredV2() {
    const attempts = await this.#sql<
      Array<AttemptRow & { reviewStartedAt: Date; needsFollowUp: boolean }>
    >`
      select attempt.id as "attemptId", attempt.order_id as "orderId",
        attempt.status, attempt.amount::int as amount, attempt.provider,
        attempt.provider_reference as "providerReference",
        attempt.redirect_url as "redirectUrl", attempt.created_at as "createdAt",
        attempt.confirmed_at as "confirmedAt",
        attempt.dispatch_lease_until as "dispatchLeaseUntil",
        coalesce(attempt.review_started_at, attempt.created_at) as "reviewStartedAt",
        exists (
          select 1 from payment_operational_alerts follow_up
          where follow_up.attempt_id = attempt.id and follow_up.status = 'OPEN'
        ) as "needsFollowUp"
      from payment_attempts attempt
      where attempt.status = 'REVIEW_REQUIRED'
        or exists (
          select 1 from payment_operational_alerts alert
          where alert.attempt_id = attempt.id and alert.status = 'OPEN'
        )
      order by attempt.created_at, attempt.id
      limit 100
    `;
    return Promise.all(
      attempts.map(async (attempt) => {
        const audits = await readPaymentReviewAudits(this.#sql, attempt.attemptId);
        const alerts = await readPaymentReviewAlerts(this.#sql, attempt.attemptId);
        return paymentReviewItemV2Contract.parse({
          reviewId: attempt.attemptId,
          reviewKind: paymentReviewKind(audits, alerts),
          amount: { amount: attempt.amount, currency: "IRR" },
          provider: attempt.provider,
          openedAt: attempt.reviewStartedAt.toISOString(),
          needsFollowUp: attempt.needsFollowUp,
        });
      }),
    );
  }

  async revealReview(command: Parameters<DirectPaymentRepository["revealReview"]>[0]) {
    if (!this.sensitiveAccess || !this.createAccessTransactionContext) {
      throw new Error("Payment review sensitive access is not configured");
    }
    return this.#sql.begin(async (sql) => {
      const authorization = await this.sensitiveAccess!.authorizeSensitiveAction(
        this.createAccessTransactionContext!(sql),
        {
          grantId: command.grantId,
          actorIdentityId: command.actorIdentityId,
          responsibility: "PAYMENT_REVIEW",
          resourceType: "PAYMENT_REVIEW",
          resourceId: command.reviewId,
          action: "REVEAL_MINIMUM",
          reason: command.reason,
          correlationId: command.correlationId,
        },
      );
      const attempts = await sql<
        Array<
          AttemptRow & {
            reconciliationCount: number;
            nextReconciliationAt: Date | null;
          }
        >
      >`
        select attempt.id as "attemptId", attempt.order_id as "orderId",
          attempt.status, attempt.amount::int as amount, attempt.provider,
          attempt.provider_reference as "providerReference",
          attempt.redirect_url as "redirectUrl", attempt.created_at as "createdAt",
          attempt.confirmed_at as "confirmedAt",
          attempt.dispatch_lease_until as "dispatchLeaseUntil",
          attempt.reconciliation_count as "reconciliationCount",
          attempt.next_reconciliation_at as "nextReconciliationAt"
        from payment_attempts attempt
        where attempt.id = ${command.reviewId}
          and (
            attempt.status = 'REVIEW_REQUIRED'
            or exists (
              select 1 from payment_operational_alerts alert
              where alert.attempt_id = attempt.id and alert.status = 'OPEN'
            )
          )
        for share
      `;
      const attempt = attempts[0];
      if (!attempt) throw new PaymentReviewNotFoundError();
      const audits = await readPaymentReviewAudits(sql, attempt.attemptId);
      const alerts = await readPaymentReviewAlerts(sql, attempt.attemptId);
      const observations = await sql<
        Array<{
          providerEventId: string;
          providerReference: string;
          result: "CONFIRMED" | "FAILED" | "PENDING";
          observedAt: Date;
        }>
      >`
        select provider_event_id as "providerEventId",
          provider_reference as "providerReference", result,
          observed_at as "observedAt"
        from payment_provider_observations
        where attempt_id = ${attempt.attemptId}
        order by observed_at, provider_event_id
      `;
      return paymentReviewDetailV2Contract.parse({
        reviewId: attempt.attemptId,
        orderId: attempt.orderId,
        status: attempt.status,
        amount: { amount: attempt.amount, currency: "IRR" },
        provider: attempt.provider,
        ...(attempt.providerReference
          ? { providerReference: attempt.providerReference }
          : {}),
        reviewKind: paymentReviewKind(audits, alerts),
        alertKinds: alerts.map((alert) => alert.kind),
        observations: observations.map((observation) => ({
          ...observation,
          observedAt: observation.observedAt.toISOString(),
        })),
        audits: audits.map(({ fromStatus, toStatus, reasonCode, occurredAt }) => ({
          fromStatus,
          toStatus,
          reasonCode,
          occurredAt: occurredAt.toISOString(),
        })),
        reconciliationCount: attempt.reconciliationCount,
        ...(attempt.nextReconciliationAt
          ? { nextReconciliationAt: attempt.nextReconciliationAt.toISOString() }
          : {}),
        revealedAt: authorization.accessedAt,
        accessExpiresAt: authorization.expiresAt,
      });
    });
  }

  async requestReconciliation(
    command: Parameters<DirectPaymentRepository["requestReconciliation"]>[0],
  ) {
    return this.#sql.begin(async (sql) => {
      if (!this.sensitiveAccess || !this.createAccessTransactionContext) {
        throw new Error("Payment review sensitive access is not configured");
      }
      await this.sensitiveAccess.authorizeSensitiveAction(
        this.createAccessTransactionContext(sql),
        {
          grantId: command.grantId,
          actorIdentityId: command.actorIdentityId,
          responsibility: "PAYMENT_REVIEW",
          resourceType: "PAYMENT_REVIEW",
          resourceId: command.reviewId,
          action: "UPDATE_CASE_STATUS",
          reason: command.reason,
          correlationId: command.correlationId,
        },
      );
      const rows = await sql<Array<{ requestedAt: Date }>>`
        update payment_attempts
        set next_reconciliation_at = least(
          coalesce(next_reconciliation_at, clock_timestamp()),
          clock_timestamp()
        )
        where id = ${command.reviewId} and status = 'REVIEW_REQUIRED'
        returning clock_timestamp() as "requestedAt"
      `;
      const result = rows[0];
      if (!result) throw new PaymentReconciliationNotAvailableError();
      return {
        reviewId: command.reviewId,
        requestedAt: result.requestedAt.toISOString(),
      };
    });
  }

  async #protectFailedAttemptFromContradictoryResult(
    sql: Sql,
    attempt: AttemptRow & { identityId: string },
    correlationId: string,
  ) {
    if (attempt.status !== "FAILED") return;
    const order = await this.orders.lockPaymentResultOrder(
      createOrderPaymentTransactionContext(sql),
      attempt.identityId as Parameters<
        OrderPaymentWorkflow["lockPaymentResultOrder"]
      >[1],
      attempt.orderId as Parameters<OrderPaymentWorkflow["lockPaymentResultOrder"]>[2],
    );
    if (!order || order.status === "PAYMENT_REVIEW") return;
    if (order.status === "PENDING_PAYMENT") {
      await this.inventory.holdReservationForProviderConflict(
        sql as unknown as InventoryTransactionContext,
        {
          reservationId: order.reservationId,
          attemptId: attempt.attemptId,
        },
      );
    }
    await this.orders.markPaymentReview(createOrderPaymentTransactionContext(sql), {
      orderId: attempt.orderId as Parameters<
        OrderPaymentWorkflow["markPaymentReview"]
      >[1]["orderId"],
      attemptId: paymentAttemptIdContract.parse(attempt.attemptId),
      occurredAt: new Date(),
      correlationId,
      reasonCode: "PAYMENT_PROVIDER_CONFLICT",
    });
  }

  async #transitionToReview(
    sql: Sql,
    input: {
      attemptId: string;
      orderId: Parameters<OrderPaymentWorkflow["markPaymentReview"]>[1]["orderId"];
      reservationId: string;
      reasonCode:
        | "DISPATCH_LEASE_EXPIRED"
        | "PROVIDER_AMOUNT_MISMATCH"
        | "PROVIDER_RESULT_PENDING"
        | "PROVIDER_INITIATION_OUTCOME_UNKNOWN";
      correlationId: string;
      occurredAt: Date;
    },
  ) {
    await this.inventory.holdReservationForReview(
      sql as unknown as InventoryTransactionContext,
      { reservationId: input.reservationId, attemptId: input.attemptId },
    );
    await this.orders.markPaymentReview(createOrderPaymentTransactionContext(sql), {
      orderId: input.orderId,
      attemptId: paymentAttemptIdContract.parse(input.attemptId),
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
      reasonCode: "PAYMENT_DISPATCH_UNRESOLVED",
    });
    await sql`
      update payment_attempts set status = 'REVIEW_REQUIRED',
        next_reconciliation_at = ${input.occurredAt},
        review_started_at = coalesce(review_started_at, ${input.occurredAt})
      where id = ${input.attemptId} and status = 'DISPATCHED'
    `;
    await insertAttemptAudit(sql, {
      attemptId: input.attemptId,
      fromStatus: "DISPATCHED",
      toStatus: "REVIEW_REQUIRED",
      reasonCode: input.reasonCode,
      correlationId: input.correlationId,
    });
    await enqueueAttemptReviewRequired(sql, {
      attemptId: input.attemptId,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
      aggregateVersion: 3,
    });
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

type PaymentReviewAuditRow = {
  fromStatus: string | null;
  toStatus: string;
  reasonCode: string;
  correlationId: string;
  occurredAt: Date;
};

type PaymentReviewAlertRow = {
  kind:
    | "RECONCILIATION_OVERDUE"
    | "PAID_STOCK_CONFLICT"
    | "PROVIDER_AMOUNT_MISMATCH"
    | "PROVIDER_RESULT_CONTRADICTION";
};

function readPaymentReviewAudits(sql: Sql, attemptId: string) {
  return sql<PaymentReviewAuditRow[]>`
    select from_status as "fromStatus", to_status as "toStatus",
      reason_code as "reasonCode", correlation_id as "correlationId",
      occurred_at as "occurredAt"
    from payment_attempt_audits
    where attempt_id = ${attemptId}
    order by occurred_at, id
  `;
}

function readPaymentReviewAlerts(sql: Sql, attemptId: string) {
  return sql<PaymentReviewAlertRow[]>`
    select kind from payment_operational_alerts
    where attempt_id = ${attemptId} and status = 'OPEN'
    order by created_at, id
  `;
}

function paymentReviewKind(
  audits: readonly Pick<PaymentReviewAuditRow, "reasonCode">[],
  alerts: readonly PaymentReviewAlertRow[],
) {
  if (audits.some((audit) => audit.reasonCode === "PAID_STOCK_CONFLICT")) {
    return "PAID_STOCK_CONFLICT" as const;
  }
  if (
    alerts.some((alert) =>
      ["PROVIDER_AMOUNT_MISMATCH", "PROVIDER_RESULT_CONTRADICTION"].includes(
        alert.kind,
      ),
    )
  ) {
    return "PROVIDER_CONFLICT" as const;
  }
  return "RESULT_AMBIGUOUS" as const;
}

async function insertAttemptAudit(
  sql: Sql,
  input: {
    attemptId: string;
    fromStatus: DirectPaymentAttemptStatus | null;
    toStatus: DirectPaymentAttemptStatus;
    reasonCode: PaymentAttemptAuditReasonCode;
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

async function enqueueAttemptFailed(
  sql: Sql,
  input: {
    attemptId: string;
    amount: number;
    occurredAt: Date;
    correlationId: string;
    aggregateVersion: number;
  },
) {
  await enqueueOutboxEvent(
    sql,
    directPaymentAttemptFailedV1Contract.parse({
      eventId: randomUUID(),
      version: 1,
      eventType: "DirectPaymentAttemptFailed.v1",
      aggregateId: input.attemptId,
      aggregateVersion: input.aggregateVersion,
      occurredAt: input.occurredAt.toISOString(),
      correlationId: eventCorrelationId(input.correlationId),
      causationId: input.attemptId,
      actor: { type: "SYSTEM" },
      payload: {
        status: "FAILED",
        amount: { amount: input.amount, currency: "IRR" },
      },
    }),
  );
}

async function enqueueAttemptReviewRequired(
  sql: Sql,
  input: {
    attemptId: string;
    occurredAt: Date;
    correlationId: string;
    aggregateVersion: number;
  },
) {
  await enqueueOutboxEvent(
    sql,
    directPaymentAttemptReviewRequiredV1Contract.parse({
      eventId: randomUUID(),
      version: 1,
      eventType: "DirectPaymentAttemptReviewRequired.v1",
      aggregateId: input.attemptId,
      aggregateVersion: input.aggregateVersion,
      occurredAt: input.occurredAt.toISOString(),
      correlationId: eventCorrelationId(input.correlationId),
      causationId: input.attemptId,
      actor: { type: "SYSTEM" },
      payload: { status: "REVIEW_REQUIRED" },
    }),
  );
}

async function insertOperationalAlert(
  sql: Sql,
  input: {
    attemptId: string;
    kind:
      | "RECONCILIATION_OVERDUE"
      | "PAID_STOCK_CONFLICT"
      | "PROVIDER_AMOUNT_MISMATCH"
      | "PROVIDER_RESULT_CONTRADICTION";
    correlationId: string;
    occurredAt: Date;
  },
) {
  await sql`
    insert into payment_operational_alerts
      (id, attempt_id, kind, severity, status, correlation_id, created_at)
    values
      (${randomUUID()}, ${input.attemptId}, ${input.kind}, 'CRITICAL', 'OPEN',
       ${input.correlationId}, ${input.occurredAt})
    on conflict (attempt_id, kind) do nothing
  `;
}

function mapAttempt(row: AttemptRow, order?: BuyerPaymentState) {
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
    ...(order
      ? {
          orderStatus: order.status,
          reservationExpiresAt: order.reservationExpiresAt.toISOString(),
        }
      : {}),
  });
}

function reconciliationDelayMs(completedQueries: number) {
  const minutes = [1, 1, 3, 5, 10, 10, 30];
  return (minutes[Math.min(completedQueries, minutes.length - 1)] ?? 30) * 60_000;
}
