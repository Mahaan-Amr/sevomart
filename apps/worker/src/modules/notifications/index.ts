import { platformSellerApplicationDecisionEventContract } from "@sevo/contracts/identity-access/v1";
import { DurableOutboxWorker, type OutboxEventHandler } from "@sevo/outbox";
import type { WorkerHandler } from "../public";

export const enqueueSellerApprovalNotification: OutboxEventHandler = async (
  event,
  sql,
) => {
  const approval = platformSellerApplicationDecisionEventContract.parse(event);
  if (
    approval.eventType !== "SellerApplicationApproved.v1" ||
    approval.payload.status !== "APPROVED" ||
    approval.aggregateId !== approval.payload.applicationId
  )
    throw new Error("invalid_approval_event");
  await sql`insert into notifications_seller_approval (event_id, application_id)
    values (${approval.eventId}, ${approval.payload.applicationId}) on conflict (event_id) do nothing`;
};

const approvalWorker: WorkerHandler = {
  async start(environment) {
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName: "notifications-seller-approval-v1",
      handlers: { "SellerApplicationApproved.v1": enqueueSellerApprovalNotification },
    });
    await worker.start();
    return () => worker.close();
  },
};
export const notifications_workerHandlers: readonly WorkerHandler[] = [approvalWorker];
