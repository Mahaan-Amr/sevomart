import { orderBecameActionableV1Contract } from "@sevo/contracts/orders/v1";
import { getMeter } from "@sevo/observability";
import { DurableOutboxWorker, type OutboxEventHandler } from "@sevo/outbox";
import postgres, { type Sql } from "postgres";

import type { WorkerHandler } from "../public";

export type FulfillmentOperationalBacklog = {
  pendingOrders: number;
  oldestAgeMs: number;
};

const fulfillmentOperationsMeter = getMeter("sevo.fulfillment.operations");
const fulfillmentBacklogMetric = fulfillmentOperationsMeter.createGauge(
  "sevo.fulfillment.backlog.orders",
);
const fulfillmentBacklogAgeMetric = fulfillmentOperationsMeter.createGauge(
  "sevo.fulfillment.backlog.oldest_age",
  { unit: "ms" },
);

export async function readFulfillmentOperationalBacklog(
  sql: Sql,
  now = new Date(),
): Promise<FulfillmentOperationalBacklog> {
  const [row] = await sql<Array<{ pendingOrders: number; oldestAgeMs: number }>>`
    select
      count(*)::integer as "pendingOrders",
      coalesce(
        extract(epoch from (${now}::timestamptz - min(updated_at))) * 1000,
        0
      )::bigint as "oldestAgeMs"
    from fulfillment_orders
    where status in ('ACTION_REQUIRED', 'PREPARING')
  `;
  return {
    pendingOrders: Number(row?.pendingOrders ?? 0),
    oldestAgeMs: Math.max(0, Number(row?.oldestAgeMs ?? 0)),
  };
}

export function startFulfillmentBacklogPoller(
  readBacklog: () => Promise<FulfillmentOperationalBacklog>,
  pollIntervalMs = 15_000,
): () => Promise<void> {
  let stopped = false;
  let finishDelay: (() => void) | undefined;
  const wait = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollIntervalMs);
      finishDelay = () => {
        clearTimeout(timer);
        resolve();
      };
    }).finally(() => {
      finishDelay = undefined;
    });
  const running = (async () => {
    while (!stopped) {
      try {
        const backlog = await readBacklog();
        fulfillmentBacklogMetric.record(backlog.pendingOrders);
        fulfillmentBacklogAgeMetric.record(backlog.oldestAgeMs);
      } catch (error: unknown) {
        if (!stopped) {
          console.error(
            JSON.stringify({
              level: "error",
              message: "fulfillment_backlog_observation_failed",
              errorType: error instanceof Error ? error.name : "UnknownError",
            }),
          );
        }
      }
      if (!stopped) await wait();
    }
  })();
  return async () => {
    stopped = true;
    finishDelay?.();
    await running;
  };
}

export const projectActionableOrder: OutboxEventHandler = async (event, sql) => {
  const actionable = orderBecameActionableV1Contract.parse(event);
  const accepted = await sql<Array<{ orderId: string }>>`
    insert into fulfillment_orders
      (order_id, status, version, accepted_event_id, created_at, updated_at)
    values
      (${actionable.aggregateId}, 'ACTION_REQUIRED', 1, ${actionable.eventId},
       ${actionable.occurredAt}, ${actionable.occurredAt})
    on conflict (order_id) do nothing
    returning order_id as "orderId"
  `;
  if (!accepted[0]) return;
  await sql`
    insert into fulfillment_timeline_entries
      (id, order_id, version, status, actor_type, actor_id,
       correlation_id, occurred_at)
    values
      (${actionable.eventId}, ${actionable.aggregateId}, 1, 'ACTION_REQUIRED',
       'SYSTEM', null, ${actionable.correlationId}, ${actionable.occurredAt})
  `;
};

const actionableOrderWorker: WorkerHandler = {
  async start(environment) {
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName: "fulfillment-actionable-orders-v1",
      handlers: { "OrderBecameActionable.v1": projectActionableOrder },
    });
    await worker.start();
    return () => worker.close();
  },
};

const fulfillmentBacklogWorker: WorkerHandler = {
  async start(environment) {
    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    const stop = startFulfillmentBacklogPoller(() =>
      readFulfillmentOperationalBacklog(sql),
    );
    return async () => {
      await stop();
      await sql.end();
    };
  },
};

export const fulfillment_workerHandlers: readonly WorkerHandler[] = [
  actionableOrderWorker,
  fulfillmentBacklogWorker,
];
