import { orderBecameActionableV1Contract } from "@sevo/contracts/orders/v1";
import { DurableOutboxWorker, type OutboxEventHandler } from "@sevo/outbox";

import type { WorkerHandler } from "../public";

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

export const fulfillment_workerHandlers: readonly WorkerHandler[] = [
  actionableOrderWorker,
];
