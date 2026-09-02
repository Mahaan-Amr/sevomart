import { describe, expect, it, vi } from "vitest";

import { startPaymentRecoveryPoller } from "./index";

describe("payment recovery poller", () => {
  it("retries a failed sweep and stops without waiting for the next interval", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const calls: number[] = [];
    const stop = startPaymentRecoveryPoller(async () => {
      calls.push(calls.length + 1);
      if (calls.length === 1) throw new Error("temporary API failure");
      return {
        recovered: 0,
        reconciliationClaimed: false,
        openOverdueReconciliations: 0,
      };
    }, 1);

    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    await stop();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('"message":"payment_recovery_sweep_failed"'),
    );
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('"consecutiveFailures":1'),
    );
    errorLog.mockRestore();
  });
});
