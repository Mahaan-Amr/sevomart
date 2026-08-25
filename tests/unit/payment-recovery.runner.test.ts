import type { RuntimeEnvironment } from "@sevo/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentRecoveryRunner } from "../../apps/api/src/modules/payments/application/payment-recovery.runner";
import type { DirectPaymentRepository } from "../../apps/api/src/modules/payments/public";

describe("PaymentRecoveryRunner", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("recovers expired dispatches at startup and on the interval", async () => {
    vi.useFakeTimers();
    const recoverExpiredDispatches = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("temporary database error"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runner = new PaymentRecoveryRunner(
      { recoverExpiredDispatches } as unknown as DirectPaymentRepository,
      { NODE_ENV: "development" } as RuntimeEnvironment,
    );

    await runner.onModuleInit();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(recoverExpiredDispatches).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("payment_dispatch_recovery_failed"),
    );
    runner.onModuleDestroy();
  });

  it("does not sweep in test applications", async () => {
    const recoverExpiredDispatches = vi.fn();
    const runner = new PaymentRecoveryRunner(
      { recoverExpiredDispatches } as unknown as DirectPaymentRepository,
      { NODE_ENV: "test" } as RuntimeEnvironment,
    );

    await runner.onModuleInit();

    expect(recoverExpiredDispatches).not.toHaveBeenCalled();
  });
});
