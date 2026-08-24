import type { RuntimeEnvironment } from "@sevo/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckoutExpiryRunner } from "../../apps/api/src/modules/orders/application/checkout-expiry.runner";
import type { CheckoutRepository } from "../../apps/api/src/modules/orders/public";

describe("CheckoutExpiryRunner", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sweeps at startup, keeps scheduling, and contains a later failure", async () => {
    vi.useFakeTimers();
    const expirePendingOrders = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("temporary database error"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runner = new CheckoutExpiryRunner(
      { expirePendingOrders } as unknown as CheckoutRepository,
      { NODE_ENV: "development" } as RuntimeEnvironment,
    );

    await runner.onModuleInit();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(expirePendingOrders).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("checkout_expiry_sweep_failed"),
    );
    runner.onModuleDestroy();
  });

  it("does not start a database sweep in contract-test apps", async () => {
    const expirePendingOrders = vi.fn();
    const runner = new CheckoutExpiryRunner(
      { expirePendingOrders } as unknown as CheckoutRepository,
      { NODE_ENV: "test" } as RuntimeEnvironment,
    );

    await runner.onModuleInit();

    expect(expirePendingOrders).not.toHaveBeenCalled();
  });
});
