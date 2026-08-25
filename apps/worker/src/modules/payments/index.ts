import type { WorkerHandler } from "../public";

type RunRecovery = (signal: AbortSignal) => Promise<void>;

export function startPaymentRecoveryPoller(
  runRecovery: RunRecovery,
  retryDelayMs = 15_000,
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

  const running = (async () => {
    while (!stopped) {
      activeRequest = new AbortController();
      try {
        await runRecovery(activeRequest.signal);
      } catch {
        // Lease and reconciliation timestamps remain the durable retry queue.
      } finally {
        activeRequest = undefined;
      }
      if (!stopped) await wait();
    }
  })();

  return async () => {
    stopped = true;
    activeRequest?.abort();
    finishDelay?.();
    await running;
  };
}

const paymentRecoveryWorker: WorkerHandler = {
  async start(environment) {
    return startPaymentRecoveryPoller(async (signal) => {
      const response = await fetch(
        new URL("/v1/internal/payment-recoveries/run", environment.INTERNAL_API_URL),
        {
          method: "POST",
          signal,
          headers: {
            "x-sevo-worker-secret": environment.PAYMENT_RECOVERY_SECRET,
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Payment recovery failed with ${response.status}`);
      }
    });
  },
};

export const payments_workerHandlers: readonly WorkerHandler[] = [
  paymentRecoveryWorker,
];
