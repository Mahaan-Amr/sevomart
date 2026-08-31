import { randomUUID } from "node:crypto";

import {
  directRefundConfirmedV1Contract,
  directRefundContract,
  directRefundFailedV1Contract,
  directRefundPendingV1Contract,
} from "@sevo/contracts/payments/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type Sql } from "postgres";

import { eventCorrelationId } from "../../../event-correlation-id";
import {
  createFulfillmentTransactionContext,
  FulfillmentFault,
  type FulfillmentRepository,
} from "../../fulfillment/public";
import {
  createInventoryTransactionContext,
  type InventoryAuthoring,
} from "../../inventory/public";
import {
  createOrderPaymentTransactionContext,
  type OrderPaymentWorkflow,
} from "../../orders/public";
import { DirectRefundFault, type DirectRefundRepository } from "../public";

type RefundRow = {
  orderId: string;
  storeId: string;
  paymentAttemptId: string;
  amount: number;
  provider: string;
  requestedBy: string;
  status: "PENDING" | "FAILED" | "CONFIRMED";
  version: number;
  updatedAt: Date;
};

export class PostgresDirectRefundRepository implements DirectRefundRepository {
  readonly #sql: Sql;

  constructor(
    databaseUrl: string,
    private readonly inventory: InventoryAuthoring,
    private readonly orders: OrderPaymentWorkflow,
    private readonly fulfillment: FulfillmentRepository,
  ) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async request(command: Parameters<DirectRefundRepository["request"]>[0]) {
    return this.#sql.begin(async (sql) => {
      const replay = await claimIdempotency(sql, "REQUEST", command.actorId, command);
      if (replay) return replay;
      await lockFulfillmentOrder(sql, command.orderId);
      const order = await this.orders.lockCancellationOrder(
        createOrderPaymentTransactionContext(sql),
        command.storeId,
        command.orderId,
      );
      if (!order) throw new DirectRefundFault("CANCELLATION_NOT_ALLOWED");
      const existing = await readRefund(sql, command.orderId, true);
      if (existing) {
        const response = mapRefund(existing);
        await saveReplay(sql, "REQUEST", command.actorId, command, response);
        return response;
      }
      if (order.status !== "PAID") {
        throw new DirectRefundFault("CANCELLATION_NOT_ALLOWED");
      }
      const attempts = await sql<
        Array<{ paymentAttemptId: string; amount: number; provider: string }>
      >`
        select id as "paymentAttemptId", amount::float8 as amount, provider
        from payment_attempts
        where order_id = ${command.orderId} and status = 'CONFIRMED'
        order by confirmed_at desc, id
        limit 1
        for share
      `;
      const attempt = attempts[0];
      if (!attempt) throw new DirectRefundFault("CANCELLATION_NOT_ALLOWED");
      try {
        await this.fulfillment.beginCancellation(
          createFulfillmentTransactionContext(sql),
          command,
        );
      } catch (error) {
        if (error instanceof FulfillmentFault) {
          throw new DirectRefundFault("CANCELLATION_NOT_ALLOWED");
        }
        throw error;
      }
      await this.orders.markCancellationPendingRefund(
        createOrderPaymentTransactionContext(sql),
        command,
      );
      await sql`
        insert into payment_direct_refunds
          (order_id, store_id, payment_attempt_id, amount, provider, status,
           version, reason, requested_by, requested_at, updated_at)
        values
          (${command.orderId}, ${command.storeId}, ${attempt.paymentAttemptId},
           ${attempt.amount}, ${attempt.provider}, 'PENDING', 1,
           ${command.input.reason}, ${command.actorId}, ${command.occurredAt},
           ${command.occurredAt})
      `;
      await insertAudit(sql, {
        ...command,
        version: 1,
        fromStatus: null,
        toStatus: "PENDING",
        actorKind: "SELLER",
        actorReference: command.actorId,
      });
      await enqueueOutboxEvent(
        sql,
        directRefundPendingV1Contract.parse({
          eventId: randomUUID(),
          version: 1,
          eventType: "DirectRefundPending.v1",
          aggregateId: command.orderId,
          aggregateVersion: 1,
          occurredAt: command.occurredAt.toISOString(),
          correlationId: eventCorrelationId(command.correlationId),
          causationId: command.causationId,
          actor: { type: "IDENTITY", id: command.actorId },
          payload: {
            status: "PENDING",
            paymentAttemptId: attempt.paymentAttemptId,
            amount: { amount: attempt.amount, currency: "IRR" },
          },
        }),
      );
      const created = await readRefund(sql, command.orderId, false);
      if (!created) throw new DirectRefundFault("REFUND_NOT_FOUND");
      const response = mapRefund(created);
      await saveReplay(sql, "REQUEST", command.actorId, command, response);
      return response;
    });
  }

  async readForSeller(
    storeId: Parameters<DirectRefundRepository["readForSeller"]>[0],
    orderId: Parameters<DirectRefundRepository["readForSeller"]>[1],
  ) {
    const rows = await this.#sql<RefundRow[]>`
      select refund.order_id as "orderId", refund.store_id as "storeId",
        refund.payment_attempt_id as "paymentAttemptId", refund.amount::float8 as amount,
        refund.provider, refund.requested_by as "requestedBy", refund.status,
        refund.version,
        refund.updated_at as "updatedAt"
      from payment_direct_refunds refund
      where refund.order_id = ${orderId} and refund.store_id = ${storeId}
    `;
    return rows[0] ? mapRefund(rows[0]) : undefined;
  }

  async recordResult(command: Parameters<DirectRefundRepository["recordResult"]>[0]) {
    return this.#sql.begin(async (sql) => {
      const replay = await claimIdempotency(
        sql,
        "RESULT",
        command.providerKey,
        command,
      );
      if (replay) return replay;
      await lockFulfillmentOrder(sql, command.orderId);
      const current = await readRefund(sql, command.orderId, true);
      if (!current || current.provider !== command.providerKey) {
        throw new DirectRefundFault("REFUND_NOT_FOUND");
      }
      if (
        current.paymentAttemptId !== command.input.paymentAttemptId ||
        current.amount !== command.input.amount.amount ||
        command.input.amount.currency !== "IRR"
      ) {
        throw new DirectRefundFault("REFUND_AMOUNT_MISMATCH");
      }
      const duplicate = await sql<Array<{ requestHash: string }>>`
        select request_hash as "requestHash"
        from payment_direct_refund_audits
        where provider = ${command.providerKey}
          and provider_event_id = ${command.providerEventId}
      `;
      if (duplicate[0]) throw new DirectRefundFault("DUPLICATE_RESULT");
      if (current.status === "CONFIRMED") {
        const response = mapRefund(current);
        await saveReplay(sql, "RESULT", command.providerKey, command, response);
        return response;
      }
      const order = await this.orders.lockCancellationOrder(
        createOrderPaymentTransactionContext(sql),
        current.storeId as Parameters<OrderPaymentWorkflow["lockCancellationOrder"]>[1],
        command.orderId,
      );
      if (!order || order.status !== "CANCELLATION_PENDING_REFUND") {
        throw new DirectRefundFault("INVALID_REFUND_TRANSITION");
      }
      const nextVersion = current.version + 1;
      await sql`
        update payment_direct_refunds
        set status = ${command.input.result}, version = ${nextVersion},
          evidence_reference = ${command.input.evidenceReference},
          updated_at = ${command.occurredAt}
        where order_id = ${command.orderId} and version = ${current.version}
      `;
      await insertAudit(sql, {
        ...command,
        version: nextVersion,
        fromStatus: current.status,
        toStatus: command.input.result,
        actorKind: "PROVIDER",
        actorReference: command.providerKey,
        evidenceReference: command.input.evidenceReference,
        provider: command.providerKey,
        providerEventId: command.providerEventId,
        requestHash: command.requestHash,
      });
      if (command.input.result === "CONFIRMED") {
        await this.fulfillment.completeCancellation(
          createFulfillmentTransactionContext(sql),
          {
            ...command,
            actorId: current.requestedBy as Parameters<
              FulfillmentRepository["completeCancellation"]
            >[1]["actorId"],
          },
        );
        await this.inventory.restoreConsumedReservationForCancellation(
          createInventoryTransactionContext(sql),
          {
            reservationId: order.reservationId,
            orderId: command.orderId,
            actorId: current.requestedBy as Parameters<
              InventoryAuthoring["restoreConsumedReservationForCancellation"]
            >[1]["actorId"],
            correlationId: command.correlationId,
            occurredAt: command.occurredAt,
          },
        );
        await this.orders.markCancelled(createOrderPaymentTransactionContext(sql), {
          ...command,
          actorId: current.requestedBy as Parameters<
            OrderPaymentWorkflow["markCancelled"]
          >[1]["actorId"],
        });
      }
      if (command.input.result === "CONFIRMED") {
        await enqueueOutboxEvent(
          sql,
          directRefundConfirmedV1Contract.parse({
            eventId: randomUUID(),
            version: 1,
            eventType: "DirectRefundConfirmed.v1",
            aggregateId: command.orderId,
            aggregateVersion: nextVersion,
            occurredAt: command.occurredAt.toISOString(),
            correlationId: eventCorrelationId(command.correlationId),
            causationId: command.causationId,
            actor: { type: "SYSTEM" },
            payload: { status: "CONFIRMED" },
          }),
        );
      } else {
        await enqueueOutboxEvent(
          sql,
          directRefundFailedV1Contract.parse({
            eventId: randomUUID(),
            version: 1,
            eventType: "DirectRefundFailed.v1",
            aggregateId: command.orderId,
            aggregateVersion: nextVersion,
            occurredAt: command.occurredAt.toISOString(),
            correlationId: eventCorrelationId(command.correlationId),
            causationId: command.causationId,
            actor: { type: "SYSTEM" },
            payload: { status: "FAILED" },
          }),
        );
      }
      const updated = await readRefund(sql, command.orderId, false);
      if (!updated) throw new DirectRefundFault("REFUND_NOT_FOUND");
      const response = mapRefund(updated);
      await saveReplay(sql, "RESULT", command.providerKey, command, response);
      return response;
    });
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

async function readRefund(sql: Sql, orderId: string, forUpdate: boolean) {
  const rows = await sql<RefundRow[]>`
    select refund.order_id as "orderId", refund.store_id as "storeId",
      refund.payment_attempt_id as "paymentAttemptId", refund.amount::float8 as amount,
      refund.provider, refund.requested_by as "requestedBy", refund.status,
      refund.version,
      refund.updated_at as "updatedAt"
    from payment_direct_refunds refund
    where refund.order_id = ${orderId}
    ${forUpdate ? sql`for update` : sql``}
  `;
  return rows[0];
}

function mapRefund(row: RefundRow) {
  return directRefundContract.parse({
    orderId: row.orderId,
    paymentAttemptId: row.paymentAttemptId,
    amount: { amount: row.amount, currency: "IRR" },
    status: row.status,
    orderStatus:
      row.status === "CONFIRMED" ? "CANCELLED" : "CANCELLATION_PENDING_REFUND",
    nextAction:
      row.status === "PENDING"
        ? "WAIT_FOR_VERIFICATION"
        : row.status === "FAILED"
          ? "RETRY_REFUND"
          : "NONE",
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function lockFulfillmentOrder(sql: Sql, orderId: string) {
  await sql`
    select pg_advisory_xact_lock(hashtextextended(${`fulfillment:${orderId}`}, 0))
  `;
}

async function claimIdempotency(
  sql: Sql,
  operation: "REQUEST" | "RESULT",
  scope: string,
  command: {
    orderId: string;
    idempotencyKey: string;
    requestHash: string;
  },
) {
  const lockKey = [
    "payments",
    "direct-refund",
    operation,
    command.orderId,
    scope,
    command.idempotencyKey,
  ].join(":");
  const locks = await sql<Array<{ locked: boolean }>>`
    select pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as locked
  `;
  if (!locks[0]?.locked) throw new DirectRefundFault("IDEMPOTENCY_IN_PROGRESS");
  const rows = await sql<Array<{ requestHash: string; response: unknown }>>`
    select request_hash as "requestHash", response_json as response
    from payment_direct_refund_idempotency_records
    where operation = ${operation} and order_id = ${command.orderId}
      and scope = ${scope} and key = ${command.idempotencyKey}
  `;
  if (!rows[0]) return undefined;
  if (rows[0].requestHash !== command.requestHash) {
    throw new DirectRefundFault(
      operation === "RESULT" ? "DUPLICATE_RESULT" : "IDEMPOTENCY_CONFLICT",
    );
  }
  return directRefundContract.parse(rows[0].response);
}

async function saveReplay(
  sql: Sql,
  operation: "REQUEST" | "RESULT",
  scope: string,
  command: {
    orderId: string;
    idempotencyKey: string;
    requestHash: string;
  },
  response: ReturnType<typeof directRefundContract.parse>,
) {
  await sql`
    insert into payment_direct_refund_idempotency_records
      (operation, order_id, scope, key, request_hash, response_json)
    values
      (${operation}, ${command.orderId}, ${scope}, ${command.idempotencyKey},
       ${command.requestHash}, ${sql.json(response)})
  `;
}

async function insertAudit(
  sql: Sql,
  input: {
    orderId: string;
    correlationId: string;
    occurredAt: Date;
    version: number;
    fromStatus: "PENDING" | "FAILED" | "CONFIRMED" | null;
    toStatus: "PENDING" | "FAILED" | "CONFIRMED";
    actorKind: "SELLER" | "PROVIDER";
    actorReference: string;
    evidenceReference?: string;
    provider?: string;
    providerEventId?: string;
    requestHash?: string;
  },
) {
  await sql`
    insert into payment_direct_refund_audits
      (id, order_id, version, from_status, to_status, evidence_reference,
       actor_kind, actor_reference, provider, provider_event_id, request_hash,
       correlation_id, occurred_at)
    values
      (${randomUUID()}, ${input.orderId}, ${input.version}, ${input.fromStatus},
       ${input.toStatus}, ${input.evidenceReference ?? null}, ${input.actorKind},
       ${input.actorReference}, ${input.provider ?? null},
       ${input.providerEventId ?? null}, ${input.requestHash ?? null},
       ${eventCorrelationId(input.correlationId)}, ${input.occurredAt})
  `;
}
