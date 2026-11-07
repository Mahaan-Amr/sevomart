import { describe, expect, it } from "vitest";
import { PaymentsModule } from "../../apps/api/src/modules/payments/composition";
import { DevDirectPaymentProvider } from "../../apps/api/src/modules/payments/testing/dev-direct-payment-provider";

describe("payment provider composition", () => {
  it("refuses an external provider while destinations are only test verified", () => {
    expect(() =>
      PaymentsModule.register(
        { SEVO_RUNTIME_ENV: "production" } as never,
        { provider: { providerKey: "real" } } as never,
      ),
    ).toThrow(/test.*settlement/i);
  });

  it("does not permit the development provider in production", () => {
    expect(() =>
      PaymentsModule.register(
        { SEVO_RUNTIME_ENV: "production" } as never,
        { provider: new DevDirectPaymentProvider("fixture") } as never,
      ),
    ).toThrow(/test.*settlement/i);
  });
});
