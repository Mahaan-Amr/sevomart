import { directRefundContract } from "@sevo/contracts/payments/v1";
import { describe, expect, it, vi } from "vitest";

import { DirectRefundApplicationService } from "../../apps/api/src/modules/payments/application/direct-refund.service";
import type {
  DirectPaymentProvider,
  DirectRefundRepository,
  DirectRefundSessionRead,
} from "../../apps/api/src/modules/payments/public";

const identityId = "0fc8f4a0-0cf8-4df0-9fde-82234ef66413";
const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef";
const refund = directRefundContract.parse({
  orderId,
  paymentAttemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
  amount: { amount: 9_500_000, currency: "IRR" },
  status: "FAILED",
  orderStatus: "CANCELLATION_PENDING_REFUND",
  nextAction: "RETRY_REFUND",
  updatedAt: "2026-08-31T08:00:00.000Z",
});

describe("DirectRefundService buyer read", () => {
  it("binds the refund read to the active buyer identity", async () => {
    const readForBuyer = vi.fn().mockResolvedValue(refund);
    const service = new DirectRefundApplicationService(
      { readForBuyer } as unknown as DirectRefundRepository,
      {
        readActiveIdentitySession: vi.fn().mockResolvedValue({ identityId }),
      } as DirectRefundSessionRead,
      {} as never,
      {} as never,
      {} as DirectPaymentProvider,
    );

    await expect(
      service.readBuyer({ sessionToken: "buyer", correlationId: "request-1" }, orderId),
    ).resolves.toEqual(refund);
    expect(readForBuyer).toHaveBeenCalledWith(identityId, orderId);
  });
});
