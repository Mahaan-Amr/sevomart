import { sellerApprovalRecoveryRequestedEventContract } from "@sevo/contracts/identity-access/v1";
import { DurableOutboxWorker, type OutboxEventHandler } from "@sevo/outbox";

import type { WorkerHandler } from "../public";

export function createSellerApprovalRecoveryHandler(
  recover: (recoveryId: string) => Promise<void>,
): OutboxEventHandler {
  return async (event) => {
    const requested = sellerApprovalRecoveryRequestedEventContract.parse(event);
    await recover(requested.payload.recoveryId);
  };
}

const sellerApprovalRecoveryWorker: WorkerHandler = {
  async start(environment) {
    const handler = createSellerApprovalRecoveryHandler(async (recoveryId) => {
      const response = await fetch(
        new URL(
          `/v1/internal/seller-approval-recoveries/${recoveryId}`,
          environment.INTERNAL_API_URL,
        ),
        {
          method: "POST",
          headers: {
            "x-sevo-worker-secret": environment.SELLER_APPROVAL_RECOVERY_SECRET,
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Seller approval recovery failed with ${response.status}`);
      }
    });
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName: "identity-seller-approval-recovery-v1",
      handlers: { "SellerApprovalRecoveryRequested.v1": handler },
    });
    await worker.start();
    return () => worker.close();
  },
};

export const identity_access_workerHandlers: readonly WorkerHandler[] = [
  sellerApprovalRecoveryWorker,
];
