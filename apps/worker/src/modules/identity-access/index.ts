import type { WorkerHandler } from "../public";

type RecoveryRequests = {
  nextPending(signal: AbortSignal): Promise<string | null>;
  recover(recoveryId: string, signal: AbortSignal): Promise<void>;
};

export function startSellerApprovalRecoveryPoller(
  requests: RecoveryRequests,
  retryDelayMs = 1_000,
): () => Promise<void> {
  let stopped = false;
  let activeRequest: AbortController | undefined;
  let finishDelay: (() => void) | undefined;

  const wait = () =>
    new Promise<void>((resolve) => {
      finishDelay = resolve;
      setTimeout(resolve, retryDelayMs);
    }).finally(() => {
      finishDelay = undefined;
    });

  const run = async () => {
    while (!stopped) {
      activeRequest = new AbortController();
      try {
        const recoveryId = await requests.nextPending(activeRequest.signal);
        if (recoveryId) await requests.recover(recoveryId, activeRequest.signal);
      } catch {
        // The durable PENDING journal row is the retry queue. Temporary API
        // failures remain recoverable until the owning module records completion.
      } finally {
        activeRequest = undefined;
      }
      if (!stopped) await wait();
    }
  };
  const running = run();

  return async () => {
    stopped = true;
    activeRequest?.abort();
    finishDelay?.();
    await running;
  };
}

const sellerApprovalRecoveryWorker: WorkerHandler = {
  async start(environment) {
    const request = async (path: string, signal: AbortSignal, method = "GET") => {
      const response = await fetch(new URL(path, environment.INTERNAL_API_URL), {
        method,
        signal,
        headers: {
          "x-sevo-worker-secret": environment.SELLER_APPROVAL_RECOVERY_SECRET,
        },
      });
      if (!response.ok) {
        throw new Error(`Seller approval recovery failed with ${response.status}`);
      }
      return response;
    };

    return startSellerApprovalRecoveryPoller({
      async nextPending(signal) {
        const response = await request(
          "/v1/internal/seller-approval-recoveries/pending",
          signal,
        );
        const body = (await response.json()) as { recoveryId?: unknown } | undefined;
        return typeof body?.recoveryId === "string" ? body.recoveryId : null;
      },
      async recover(recoveryId, signal) {
        await request(
          `/v1/internal/seller-approval-recoveries/${recoveryId}`,
          signal,
          "POST",
        );
      },
    });
  },
};

export const identity_access_workerHandlers: readonly WorkerHandler[] = [
  sellerApprovalRecoveryWorker,
];
