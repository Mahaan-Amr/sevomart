import { describe, expect, it, vi } from "vitest";

import { startFulfillmentBacklogPoller } from "./index";

describe("fulfillment backlog poller", () => {
  it("retries an observation failure and stops without waiting for the interval", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const stop = startFulfillmentBacklogPoller(async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary database failure");
      return { pendingOrders: 2, oldestAgeMs: 60_000 };
    }, 1);

    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
    await stop();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('"message":"fulfillment_backlog_observation_failed"'),
    );
    errorLog.mockRestore();
  });
});
