import { describe, expect, it, vi } from "vitest";

import { PaymentRecoveryRunner } from "../../apps/api/src/modules/payments/application/payment-recovery.runner";
import type {
  DirectPaymentRepository,
  DirectPaymentService,
} from "../../apps/api/src/modules/payments/public";

describe("PaymentRecoveryRunner", () => {
  it("recovers expired attempts and claims one reconciliation in a worker cycle", async () => {
    const now = new Date("2026-08-25T08:00:00.000Z");
    const recoverExpiredAttempts = vi.fn().mockResolvedValue(2);
    const reconcileNext = vi.fn().mockResolvedValue(true);
    const runner = new PaymentRecoveryRunner(
      { recoverExpiredAttempts } as unknown as DirectPaymentRepository,
      { reconcileNext } as unknown as DirectPaymentService,
    );

    await expect(runner.runOnce(now)).resolves.toEqual({
      recovered: 2,
      reconciliationClaimed: true,
    });
    expect(recoverExpiredAttempts).toHaveBeenCalledWith(now, expect.any(String));
    expect(reconcileNext).toHaveBeenCalledWith(now, expect.any(String));
  });

  it("reports an idle cycle without owning an in-process timer", async () => {
    const recoverExpiredAttempts = vi.fn().mockResolvedValue(0);
    const reconcileNext = vi.fn().mockResolvedValue(false);
    const runner = new PaymentRecoveryRunner(
      { recoverExpiredAttempts } as unknown as DirectPaymentRepository,
      { reconcileNext } as unknown as DirectPaymentService,
    );

    await expect(runner.runOnce()).resolves.toEqual({
      recovered: 0,
      reconciliationClaimed: false,
    });
    expect(recoverExpiredAttempts).toHaveBeenCalledTimes(1);
    expect(reconcileNext).toHaveBeenCalledTimes(1);
  });
});
