import { fulfillmentAdvancedV1Contract } from "@sevo/contracts/fulfillment/v1";
import { orderBecameActionableV1Contract } from "@sevo/contracts/orders/v1";
import { DurableOutboxWorker, type OutboxEventHandler } from "@sevo/outbox";

import type { WorkerHandler } from "../public";

export const projectRelatedBuyerFulfillmentStatus: OutboxEventHandler = async (
  event,
  sql,
) => {
  const projected =
    event.eventType === "OrderBecameActionable.v1"
      ? (() => {
          const actionable = orderBecameActionableV1Contract.parse(event);
          return {
            orderId: actionable.aggregateId,
            status: "ACTION_REQUIRED" as const,
            version: 1,
            eventId: actionable.eventId,
            occurredAt: actionable.occurredAt,
          };
        })()
      : (() => {
          const advanced = fulfillmentAdvancedV1Contract.parse(event);
          return {
            orderId: advanced.aggregateId,
            status: advanced.payload.toStatus,
            version: advanced.aggregateVersion,
            eventId: advanced.eventId,
            occurredAt: advanced.occurredAt,
          };
        })();
  await sql`
    insert into order_fulfillment_status_projections
      (order_id, status, version, accepted_event_id, updated_at)
    values (${projected.orderId}, ${projected.status}, ${projected.version},
      ${projected.eventId}, ${projected.occurredAt})
    on conflict (order_id) do update
    set status = excluded.status, version = excluded.version,
      accepted_event_id = excluded.accepted_event_id,
      updated_at = excluded.updated_at
    where order_fulfillment_status_projections.version < excluded.version
  `;
};

const relatedBuyerFulfillmentWorker: WorkerHandler = {
  async start(environment) {
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName: "orders-related-buyer-fulfillment-v1",
      handlers: {
        "OrderBecameActionable.v1": projectRelatedBuyerFulfillmentStatus,
        "FulfillmentAdvanced.v1": projectRelatedBuyerFulfillmentStatus,
      },
    });
    await worker.start();
    return () => worker.close();
  },
};

export const orders_workerHandlers: readonly WorkerHandler[] = [
  relatedBuyerFulfillmentWorker,
];
