import { describe, expect, it } from "vitest";

import { DevDirectPaymentProvider } from "../../apps/api/src/modules/payments/testing/dev-direct-payment-provider";

describe("DevDirectPaymentProvider", () => {
  it("initiates and verifies a deterministic successful callback", async () => {
    const provider = new DevDirectPaymentProvider("test-signing-secret");
    const initiated = await provider.initiate({
      attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
      amount: { amount: 4_500_000, currency: "IRR" },
    });

    expect(initiated).toEqual({
      providerReference: "dev-91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      redirectUrl: "/v1/payment-providers/dev/pay/91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    });
    const callback = provider.successCallback({
      attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
      amount: 4_500_000,
      providerEventId: "dev-event-1",
    });
    await expect(provider.verifyAndMapCallback(callback)).resolves.toMatchObject({
      result: "CONFIRMED",
      amount: 4_500_000,
      providerReference: "dev-91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    });
  });

  it("rejects a callback whose signed amount was changed", async () => {
    const provider = new DevDirectPaymentProvider("test-signing-secret");
    const callback = provider.successCallback({
      attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
      amount: 4_500_000,
      providerEventId: "dev-event-1",
    });

    await expect(
      provider.verifyAndMapCallback({ ...callback, amount: 10 }),
    ).rejects.toThrow("Invalid provider callback");
  });

  it("deterministically represents failed and pending fixtures and queries pending", async () => {
    const provider = new DevDirectPaymentProvider("test-signing-secret");
    const pending = provider.callback({
      attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca272",
      orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
      amount: 4_500_000,
      providerEventId: "dev-pending-1",
      result: "PENDING",
    });
    const verified = await provider.verifyAndMapCallback(pending);
    expect(verified.result).toBe("PENDING");
    await expect(
      provider.query({
        attemptId: verified.attemptId,
        orderId: verified.orderId,
        amount: { amount: verified.amount, currency: "IRR" },
        providerReference: verified.providerReference,
      }),
    ).resolves.toMatchObject({ result: "CONFIRMED" });

    await expect(
      provider.verifyAndMapCallback(
        provider.callback({
          attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
          orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
          amount: 4_500_000,
          providerEventId: "dev-failed-1",
          result: "FAILED",
        }),
      ),
    ).resolves.toMatchObject({ result: "FAILED" });
  });
});
