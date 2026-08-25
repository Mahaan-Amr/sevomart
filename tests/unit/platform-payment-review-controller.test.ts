import { describe, expect, it, vi } from "vitest";

import { PlatformPaymentReviewController } from "../../apps/api/src/modules/payments/payment.controller";
import type { PlatformAgentSessionAuthorizer } from "../../apps/api/src/modules/identity-access/public";
import type { DirectPaymentService } from "../../apps/api/src/modules/payments/public";

describe("platform payment review controller", () => {
  it("shows an authorized agent the read-only review queue with its audit", async () => {
    const listReviewRequired = vi.fn(async () => [
      {
        attempt: {
          attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
          orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
          status: "REVIEW_REQUIRED" as const,
          amount: { amount: 4_500_000, currency: "IRR" as const },
          provider: "DEV",
          createdAt: "2026-08-25T08:00:00.000Z",
        },
        orderStatus: "PAYMENT_REVIEW" as const,
        audits: [
          {
            fromStatus: "DISPATCHED",
            toStatus: "REVIEW_REQUIRED",
            reasonCode: "DISPATCH_LEASE_EXPIRED",
            correlationId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
            occurredAt: "2026-08-25T08:01:00.000Z",
          },
        ],
      },
    ]);
    const authorizePaymentReview = vi.fn(async () => ({
      identityId: "agent-1",
      audience: "PLATFORM_AGENT" as const,
      permission: "PAYMENT_REVIEW" as const,
    }));
    const controller = new PlatformPaymentReviewController(
      { listReviewRequired } as unknown as DirectPaymentService,
      { authorizePaymentReview } as unknown as PlatformAgentSessionAuthorizer,
    );

    await expect(
      controller.list({
        id: "request-1",
        headers: { cookie: "sevo_platform_session=agent-token" },
      } as never),
    ).resolves.toMatchObject({
      items: [
        {
          attempt: { status: "REVIEW_REQUIRED" },
          audits: [{ reasonCode: "DISPATCH_LEASE_EXPIRED" }],
        },
      ],
    });
    expect(authorizePaymentReview).toHaveBeenCalledWith("agent-token");
    expect(listReviewRequired).toHaveBeenCalledOnce();
  });
});
