import { randomUUID } from "node:crypto";

import {
  fulfillmentAdvancedV1Contract,
  fulfillmentTimelineContract,
  type FulfillmentTimeline,
  type FulfillmentStatus,
} from "@sevo/contracts/fulfillment/v1";
import { storeIdContract } from "@sevo/contracts/platform/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type JSONValue, type Sql } from "postgres";

import { FulfillmentFault, type FulfillmentRepository } from "../public";
import { nextFulfillmentStatus } from "../application/fulfillment-state";

type TimelineRow = {
  orderId: string;
  currentStatus: FulfillmentStatus;
  version: number;
  status: FulfillmentStatus;
  actorType: "IDENTITY" | "SYSTEM";
  actorId: string | null;
  correlationId: string;
  occurredAt: Date;
  shippingMethod: string | null;
  trackingCode: string | null;
};

const advanceOperation = "ADVANCE";

export class PostgresFulfillmentRepository implements FulfillmentRepository {
  readonly #sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async read(orderId: Parameters<FulfillmentRepository["read"]>[0]) {
    return readTimeline(this.#sql, orderId);
  }

  async readOrderSnapshot(
    orderId: Parameters<FulfillmentRepository["readOrderSnapshot"]>[0],
  ) {
    const rows = await this.#sql<
      Array<{
        storeId: string | null;
        status: FulfillmentStatus;
        shippedAt: Date | null;
        deliveredAt: Date | null;
      }>
    >`
      select orders.store_id as "storeId", orders.status,
        max(entries.occurred_at) filter (where entries.status = 'SHIPPED') as "shippedAt",
        max(entries.occurred_at) filter (where entries.status = 'DELIVERED') as "deliveredAt"
      from fulfillment_orders orders
      join fulfillment_timeline_entries entries on entries.order_id = orders.order_id
      where orders.order_id = ${orderId}
      group by orders.store_id, orders.status
    `;
    const row = rows[0];
    if (!row?.storeId || !row.shippedAt) return undefined;
    const common = {
      storeId: storeIdContract.parse(row.storeId),
      shippedAt: row.shippedAt.toISOString(),
    };
    return row.deliveredAt
      ? {
          ...common,
          status: "DELIVERED" as const,
          deliveredAt: row.deliveredAt.toISOString(),
        }
      : { ...common, status: "SHIPPED" as const };
  }

  async replayAdvance(command: Parameters<FulfillmentRepository["replayAdvance"]>[0]) {
    return readAdvanceReplay(this.#sql, command);
  }

  async advance(command: Parameters<FulfillmentRepository["advance"]>[0]) {
    return this.#sql.begin(async (sql) => {
      const replay = await claimAdvance(sql, command);
      if (replay) return replay;
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`fulfillment:${command.orderId}`}, 0)
        )
      `;
      const current = await sql<
        Array<{ status: FulfillmentStatus; version: number; storeId: string | null }>
      >`
        select status, version, store_id as "storeId" from fulfillment_orders
        where order_id = ${command.orderId}
        for update
      `;
      if (
        !current[0] ||
        current[0].status !== command.expectedStatus ||
        nextFulfillmentStatus(current[0].status) !== command.input.targetStatus ||
        (current[0].storeId !== null && current[0].storeId !== command.storeId)
      ) {
        throw new FulfillmentFault("INVALID_TRANSITION");
      }
      const version = current[0].version + 1;
      const entryId = randomUUID();
      await sql`
        update fulfillment_orders
        set status = ${command.input.targetStatus}, version = ${version},
          store_id = coalesce(store_id, ${command.storeId}), updated_at = ${command.occurredAt}
        where order_id = ${command.orderId}
      `;
      await sql`
        insert into fulfillment_timeline_entries
          (id, order_id, version, status, actor_type, actor_id, correlation_id,
           occurred_at, shipping_method, tracking_code)
        values
          (${entryId}, ${command.orderId}, ${version}, ${command.input.targetStatus},
           'IDENTITY', ${command.actorId}, ${command.correlationId},
           ${command.occurredAt},
           ${command.input.targetStatus === "SHIPPED" ? command.input.shipping.method : null},
           ${command.input.targetStatus === "SHIPPED" ? (command.input.shipping.trackingCode ?? null) : null})
      `;
      await enqueueOutboxEvent(
        sql,
        fulfillmentAdvancedV1Contract.parse({
          version: 1,
          eventId: randomUUID(),
          eventType: "FulfillmentAdvanced.v1",
          aggregateId: command.orderId,
          aggregateVersion: version,
          occurredAt: command.occurredAt.toISOString(),
          correlationId: command.correlationId,
          causationId: command.causationId,
          actor: { type: "IDENTITY", id: command.actorId },
          payload: {
            fromStatus: current[0].status,
            toStatus: command.input.targetStatus,
          },
        }),
      );
      const result = await readTimeline(sql, command.orderId);
      if (!result) throw new FulfillmentFault("FULFILLMENT_NOT_FOUND");
      await sql`
        update fulfillment_idempotency_records
        set state = 'COMPLETED', locked_until = now(), completed_at = now(),
          response_json = ${sql.json(asJson(result))}
        where operation = ${advanceOperation} and order_id = ${command.orderId}
          and actor_id = ${command.actorId} and key = ${command.idempotencyKey}
      `;
      return result;
    });
  }

  async beginCancellation(
    transaction: Parameters<FulfillmentRepository["beginCancellation"]>[0],
    command: Parameters<FulfillmentRepository["beginCancellation"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<
      Array<{ status: FulfillmentStatus; version: number; storeId: string | null }>
    >`
      select status, version, store_id as "storeId" from fulfillment_orders
      where order_id = ${command.orderId} for update
    `;
    const current = rows[0];
    if (
      !current ||
      (current.storeId !== null && current.storeId !== command.storeId) ||
      !["ACTION_REQUIRED", "PREPARING", "CANCELLATION_PENDING_REFUND"].includes(
        current.status,
      )
    ) {
      throw new FulfillmentFault("INVALID_TRANSITION");
    }
    if (current.status === "CANCELLATION_PENDING_REFUND") return;
    await transitionCancellation(sql, current, {
      ...command,
      targetStatus: "CANCELLATION_PENDING_REFUND",
    });
  }

  async completeCancellation(
    transaction: Parameters<FulfillmentRepository["completeCancellation"]>[0],
    command: Parameters<FulfillmentRepository["completeCancellation"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<Array<{ status: FulfillmentStatus; version: number }>>`
      select status, version from fulfillment_orders
      where order_id = ${command.orderId} for update
    `;
    const current = rows[0];
    if (
      !current ||
      !["CANCELLATION_PENDING_REFUND", "CANCELLED"].includes(current.status)
    ) {
      throw new FulfillmentFault("INVALID_TRANSITION");
    }
    if (current.status === "CANCELLED") return;
    await transitionCancellation(sql, current, {
      ...command,
      targetStatus: "CANCELLED",
    });
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

async function readTimeline(sql: ReturnType<typeof postgres>, orderId: string) {
  const rows = await sql<TimelineRow[]>`
    select orders.order_id as "orderId", orders.status as "currentStatus",
      entries.version, entries.status, entries.actor_type as "actorType",
      entries.actor_id as "actorId", entries.correlation_id as "correlationId",
      entries.occurred_at as "occurredAt",
      entries.shipping_method as "shippingMethod",
      entries.tracking_code as "trackingCode"
    from fulfillment_orders orders
    join fulfillment_timeline_entries entries on entries.order_id = orders.order_id
    where orders.order_id = ${orderId}
    order by entries.version
  `;
  return rows.length === 0 ? undefined : timelineFromRows(rows);
}

async function readAdvanceReplay(
  sql: ReturnType<typeof postgres>,
  command: {
    orderId: string;
    actorId: string;
    idempotencyKey: string;
    requestHash: string;
  },
) {
  const rows = await sql<
    Array<{
      requestHash: string;
      state: "IN_PROGRESS" | "COMPLETED";
      lockedUntil: Date;
      response: JSONValue | null;
    }>
  >`
    select request_hash as "requestHash", state, locked_until as "lockedUntil",
      response_json as response
    from fulfillment_idempotency_records
    where operation = ${advanceOperation} and order_id = ${command.orderId}
      and actor_id = ${command.actorId}
      and key = ${command.idempotencyKey}
  `;
  if (!rows[0]) return undefined;
  if (rows[0].requestHash !== command.requestHash) {
    throw new FulfillmentFault("IDEMPOTENCY_CONFLICT");
  }
  if (rows[0].state === "COMPLETED" && rows[0].response !== null) {
    return fulfillmentTimelineContract.parse(rows[0].response);
  }
  if (rows[0].lockedUntil.getTime() > Date.now()) {
    throw new FulfillmentFault("IDEMPOTENCY_IN_PROGRESS");
  }
  return undefined;
}

async function claimAdvance(
  sql: ReturnType<typeof postgres>,
  command: Parameters<FulfillmentRepository["advance"]>[0],
) {
  const lockKey = [
    "fulfillment",
    advanceOperation,
    command.orderId,
    command.actorId,
    command.idempotencyKey,
  ].join(":");
  const lock = await sql<Array<{ locked: boolean }>>`
    select pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as locked
  `;
  if (!lock[0]?.locked) throw new FulfillmentFault("IDEMPOTENCY_IN_PROGRESS");

  const replay = await readAdvanceReplay(sql, command);
  if (replay) return replay;
  const updated = await sql`
    update fulfillment_idempotency_records
    set state = 'IN_PROGRESS', locked_until = now() + interval '30 seconds',
      response_json = null, correlation_id = ${command.correlationId}, completed_at = null
    where operation = ${advanceOperation} and order_id = ${command.orderId}
      and actor_id = ${command.actorId} and key = ${command.idempotencyKey}
    returning key
  `;
  if (updated.count === 0) {
    await sql`
      insert into fulfillment_idempotency_records
        (operation, order_id, actor_id, key, request_hash, state, locked_until,
         correlation_id)
      values
        (${advanceOperation}, ${command.orderId}, ${command.actorId},
         ${command.idempotencyKey}, ${command.requestHash}, 'IN_PROGRESS',
         now() + interval '30 seconds', ${command.correlationId})
    `;
  }
  return undefined;
}

function timelineFromRows(rows: TimelineRow[]): FulfillmentTimeline {
  const first = rows[0];
  if (!first) throw new FulfillmentFault("FULFILLMENT_NOT_FOUND");
  return fulfillmentTimelineContract.parse({
    orderId: first.orderId,
    status: first.currentStatus,
    nextStatus: nextFulfillmentStatus(first.currentStatus),
    timeline: rows.map((row) => ({
      status: row.status,
      actor:
        row.actorType === "IDENTITY"
          ? { type: "IDENTITY", id: row.actorId }
          : { type: "SYSTEM" },
      occurredAt: row.occurredAt.toISOString(),
      correlationId: row.correlationId,
      ...(row.shippingMethod
        ? {
            shipping: {
              method: row.shippingMethod,
              ...(row.trackingCode ? { trackingCode: row.trackingCode } : {}),
            },
          }
        : {}),
    })),
  });
}

async function transitionCancellation(
  sql: Sql,
  current: { status: FulfillmentStatus; version: number },
  command: {
    orderId: string;
    actorId: string;
    storeId?: string;
    correlationId: string;
    causationId: string;
    occurredAt: Date;
    targetStatus: Extract<
      FulfillmentStatus,
      "CANCELLATION_PENDING_REFUND" | "CANCELLED"
    >;
  },
) {
  const version = current.version + 1;
  await sql`
    update fulfillment_orders
    set status = ${command.targetStatus}, version = ${version},
      store_id = coalesce(store_id, ${command.storeId ?? null}::uuid),
      updated_at = ${command.occurredAt}
    where order_id = ${command.orderId}
  `;
  await sql`
    insert into fulfillment_timeline_entries
      (id, order_id, version, status, actor_type, actor_id, correlation_id,
       occurred_at, shipping_method, tracking_code)
    values
      (${randomUUID()}, ${command.orderId}, ${version}, ${command.targetStatus},
       'IDENTITY', ${command.actorId}, ${command.correlationId},
       ${command.occurredAt}, null, null)
  `;
  await enqueueOutboxEvent(
    sql,
    fulfillmentAdvancedV1Contract.parse({
      version: 1,
      eventId: randomUUID(),
      eventType: "FulfillmentAdvanced.v1",
      aggregateId: command.orderId,
      aggregateVersion: version,
      occurredAt: command.occurredAt.toISOString(),
      correlationId: command.correlationId,
      causationId: command.causationId,
      actor: { type: "IDENTITY", id: command.actorId },
      payload: { fromStatus: current.status, toStatus: command.targetStatus },
    }),
  );
}

function asJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
