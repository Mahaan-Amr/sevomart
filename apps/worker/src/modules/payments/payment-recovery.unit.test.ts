import { describe, expect, it, vi } from "vitest";

import { startPaymentRecoveryPoller } from "./index";

describe("payment recovery poller", () => {
  it("retries a failed sweep and stops without waiting for the next interval", async () => {
    const calls: number[] = [];
    const stop = startPaymentRecoveryPoller(async () => {
      calls.push(calls.length + 1);
      if (calls.length === 1) throw new Error("temporary API failure");
    }, 1);

    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    await stop();
  });
});
