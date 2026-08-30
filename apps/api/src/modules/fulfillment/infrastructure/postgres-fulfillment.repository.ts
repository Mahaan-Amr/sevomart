import { randomUUID } from "node:crypto";

import {
  fulfillmentAdvancedV1Contract,
  fulfillmentTimelineContract,
  type FulfillmentTimeline,
  type FulfillmentStatus,
} from "@sevo/contracts/fulfillment/v1";
import { storeIdContract } from "@sevo/contracts/platform/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type JSONValue } from "postgres";

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
        and orders.status in ('SHIPPED', 'DELIVERED')
      group by orders.store_id, orders.status
    `;
    const row = rows[0];
    if (!row?.storeId || !row.shippedAt) return undefined;
    const common = {
      storeId: storeIdContract.parse(row.storeId),
      shippedAt: row.shippedAt.toISOString(),
    };
    return row.status === "DELIVERED" && row.deliveredAt
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
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`fulfillment:${command.orderId}`}, 0)
        )
      `;
      const replay = await readAdvanceReplay(sql, command);
      if (replay) return replay;
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
          causationId: entryId,
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
        insert into fulfillment_idempotency_records
          (order_id, actor_id, key, request_hash, response_json, correlation_id)
        values
          (${command.orderId}, ${command.actorId}, ${command.idempotencyKey},
           ${command.requestHash}, ${sql.json(asJson(result))}, ${command.correlationId})
      `;
      return result;
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
  const rows = await sql<Array<{ requestHash: string; response: JSONValue }>>`
    select request_hash as "requestHash", response_json as response
    from fulfillment_idempotency_records
    where order_id = ${command.orderId} and actor_id = ${command.actorId}
      and key = ${command.idempotencyKey}
  `;
  if (!rows[0]) return undefined;
  if (rows[0].requestHash !== command.requestHash) {
    throw new FulfillmentFault("IDEMPOTENCY_CONFLICT");
  }
  return fulfillmentTimelineContract.parse(rows[0].response);
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

function asJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
