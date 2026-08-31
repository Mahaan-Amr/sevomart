import { fulfillmentAdvancedV1Contract } from "@sevo/contracts/fulfillment/v1";
import { orderReportingSnapshotV1Contract } from "@sevo/contracts/orders/v1";
import {
  disputeOpenedV1Contract,
  disputeReopenedV1Contract,
  disputeResolvedV1Contract,
  disputeRespondedV1Contract,
} from "@sevo/contracts/problem-follow-up/v1";
import { storePublishedV1Contract } from "@sevo/contracts/store/v1";
import {
  catchUpOutboxConsumer,
  DurableOutboxWorker,
  type OutboxEventHandler,
} from "@sevo/outbox";

import type { WorkerHandler } from "../public";

export const projectStorePublication: OutboxEventHandler = async (event, sql) => {
  const publication = storePublishedV1Contract.parse(event);
  await sql`
    insert into reporting_store_publications
      (store_id, last_event_id, publication_version, published_at, projected_at)
    values
      (${publication.payload.storeId}, ${publication.eventId},
       ${publication.payload.publicationVersion ?? publication.aggregateVersion},
       ${publication.occurredAt}, now())
    on conflict (store_id) do update set
      last_event_id = excluded.last_event_id,
      publication_version = excluded.publication_version,
      published_at = excluded.published_at,
      projected_at = excluded.projected_at
    where reporting_store_publications.publication_version
      < excluded.publication_version
  `;
};

export const projectFulfillmentState: OutboxEventHandler = async (event, sql) => {
  const fulfillment = fulfillmentAdvancedV1Contract.parse(event);
  await sql`
    insert into reporting_fulfillment_states
      (order_id, status, aggregate_version, last_event_id, occurred_at, projected_at)
    values
      (${fulfillment.aggregateId}, ${fulfillment.payload.toStatus},
       ${fulfillment.aggregateVersion}, ${fulfillment.eventId},
       ${fulfillment.occurredAt}, now())
    on conflict (order_id) do update set
      status = excluded.status,
      aggregate_version = excluded.aggregate_version,
      last_event_id = excluded.last_event_id,
      occurred_at = excluded.occurred_at,
      projected_at = excluded.projected_at
    where reporting_fulfillment_states.aggregate_version
      < excluded.aggregate_version
  `;
};

export const projectSellerOrderFact: OutboxEventHandler = async (event, sql) => {
  const order = orderReportingSnapshotV1Contract.parse(event);
  await sql`
    insert into reporting_seller_order_facts
      (order_id, store_id, total_amount, currency, paid_at,
       aggregate_version, last_event_id, projected_at)
    values
      (${order.aggregateId}, ${order.payload.storeId}, ${order.payload.total.amount},
       ${order.payload.total.currency}, ${order.payload.paidAt},
       ${order.aggregateVersion}, ${order.eventId}, now())
    on conflict (order_id) do update set
      store_id = excluded.store_id,
      total_amount = excluded.total_amount,
      currency = excluded.currency,
      paid_at = excluded.paid_at,
      aggregate_version = excluded.aggregate_version,
      last_event_id = excluded.last_event_id,
      projected_at = excluded.projected_at
    where reporting_seller_order_facts.aggregate_version
      < excluded.aggregate_version
  `;
};

export const projectDisputeState: OutboxEventHandler = async (event, sql) => {
  if (event.eventType === "DisputeOpened.v1") {
    const dispute = disputeOpenedV1Contract.parse(event);
    await sql`
      insert into reporting_seller_dispute_states
        (dispute_id, store_id, order_id, status, deadline_at,
         aggregate_version, last_event_id, occurred_at, projected_at)
      values
        (${dispute.payload.disputeId}, ${dispute.payload.storeId},
         ${dispute.payload.orderId}, ${dispute.payload.status},
         ${dispute.payload.deadlineAt}, ${dispute.aggregateVersion},
         ${dispute.eventId}, ${dispute.occurredAt}, now())
      on conflict (dispute_id) do update set
        status = excluded.status,
        deadline_at = excluded.deadline_at,
        aggregate_version = excluded.aggregate_version,
        last_event_id = excluded.last_event_id,
        occurred_at = excluded.occurred_at,
        projected_at = excluded.projected_at
      where reporting_seller_dispute_states.aggregate_version
        < excluded.aggregate_version
    `;
    return;
  }

  const transition =
    event.eventType === "DisputeResponded.v1"
      ? disputeRespondedV1Contract.parse(event)
      : event.eventType === "DisputeResolved.v1"
        ? disputeResolvedV1Contract.parse(event)
        : disputeReopenedV1Contract.parse(event);
  await sql`
    update reporting_seller_dispute_states
    set status = ${transition.payload.toStatus},
      deadline_at = ${transition.payload.nextDeadlineAt},
      aggregate_version = ${transition.aggregateVersion},
      last_event_id = ${transition.eventId},
      occurred_at = ${transition.occurredAt},
      projected_at = now()
    where dispute_id = ${transition.payload.disputeId}
      and aggregate_version < ${transition.aggregateVersion}
  `;
};

const storePublicationProjectionWorker: WorkerHandler = {
  async start(environment) {
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName: "reporting-store-publications-v1",
      handlers: { "StorePublished.v1": projectStorePublication },
    });
    await worker.start();
    return () => worker.close();
  },
};

const sellerOperationsProjectionWorker: WorkerHandler = {
  async start(environment) {
    const consumerName = "reporting-seller-operations-v1";
    const handlers = {
      "OrderReportingSnapshot.v1": projectSellerOrderFact,
      "FulfillmentAdvanced.v1": projectFulfillmentState,
      "DisputeOpened.v1": projectDisputeState,
      "DisputeResponded.v1": projectDisputeState,
      "DisputeResolved.v1": projectDisputeState,
      "DisputeReopened.v1": projectDisputeState,
    };
    await catchUpOutboxConsumer(environment.DATABASE_URL, {
      consumerName,
      handlers,
    });
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName,
      handlers,
    });
    await worker.start();
    return () => worker.close();
  },
};

export const reporting_analytics_workerHandlers: readonly WorkerHandler[] = [
  storePublicationProjectionWorker,
  sellerOperationsProjectionWorker,
];
