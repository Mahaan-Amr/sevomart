import { getMeter } from "@sevo/observability";

import type { WorkerHandler } from "../public";

type RunRecovery = (signal: AbortSignal) => Promise<void>;

const paymentRecoveryFailureMetric = getMeter("sevo.payments.recovery").createCounter(
  "sevo_payment_recovery_failures_total",
);

export function startPaymentRecoveryPoller(
  runRecovery: RunRecovery,
  retryDelayMs = 15_000,
): () => Promise<void> {
  let stopped = false;
  let activeRequest: AbortController | undefined;
  let finishDelay: (() => void) | undefined;
  let consecutiveFailures = 0;

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
        consecutiveFailures = 0;
      } catch (error: unknown) {
        if (!stopped) {
          consecutiveFailures += 1;
          const errorType = error instanceof Error ? error.name : "UnknownError";
          paymentRecoveryFailureMetric.add(1, { error_type: errorType });
          console.error(
            JSON.stringify({
              level: "error",
              message: "payment_recovery_sweep_failed",
              errorType,
              consecutiveFailures,
            }),
          );
        }
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
