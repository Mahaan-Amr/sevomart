import { describe, expect, it, vi } from "vitest";

import { PlatformPaymentReviewController } from "../../apps/api/src/modules/payments/payment.controller";
import type { PlatformAgentSessionAuthorizer } from "../../apps/api/src/modules/identity-access/public";
import type { DirectPaymentService } from "../../apps/api/src/modules/payments/public";

describe("platform payment review controller", () => {
  it("shows an authorized agent the read-only review queue with its audit", async () => {
    const listReviewRequiredV2 = vi.fn(async () => [
      {
        reviewId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
        reviewKind: "RESULT_AMBIGUOUS" as const,
        amount: { amount: 4_500_000, currency: "IRR" as const },
        provider: "DEV",
        openedAt: "2026-08-25T08:01:00.000Z",
        needsFollowUp: false,
      },
    ]);
    const authorizePaymentReview = vi.fn(async () => ({
      identityId: "agent-1",
      audience: "PLATFORM_AGENT" as const,
      permission: "PAYMENT_REVIEW" as const,
    }));
    const controller = new PlatformPaymentReviewController(
      { listReviewRequiredV2 } as unknown as DirectPaymentService,
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
          reviewId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
          reviewKind: "RESULT_AMBIGUOUS",
        },
      ],
    });
    expect(authorizePaymentReview).toHaveBeenCalledWith("agent-token");
    expect(listReviewRequiredV2).toHaveBeenCalledOnce();
  });

  it("reveals one case with an explicit grant and can only request provider reconciliation", async () => {
    const revealReview = vi.fn(async () => ({
      reviewId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
      status: "REVIEW_REQUIRED" as const,
      amount: { amount: 4_500_000, currency: "IRR" as const },
      provider: "DEV",
      reviewKind: "RESULT_AMBIGUOUS" as const,
      alertKinds: [],
      observations: [],
      audits: [],
      reconciliationCount: 1,
      revealedAt: "2026-08-25T08:02:00.000Z",
      accessExpiresAt: "2026-08-25T08:30:00.000Z",
    }));
    const requestReconciliation = vi.fn(async () => ({
      reviewId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      requestedAt: "2026-08-25T08:03:00.000Z",
    }));
    const authorizePaymentReview = vi.fn(async () => ({
      identityId: "27a3f408-858c-45d7-a0bd-ab84a28718ef",
      audience: "PLATFORM_AGENT" as const,
      permission: "PAYMENT_REVIEW" as const,
    }));
    const controller = new PlatformPaymentReviewController(
      { revealReview, requestReconciliation } as unknown as DirectPaymentService,
      { authorizePaymentReview } as unknown as PlatformAgentSessionAuthorizer,
    );
    const request = {
      id: "request-151",
      headers: { cookie: "sevo_platform_session=agent-token" },
    } as never;

    await controller.reveal(
      "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      {
        grantId: "81fe87eb-6c0f-47ca-93ca-9f9a038ca271",
        reason: "بررسی مدرک درگاه برای این پرونده پرداخت",
      },
      request,
    );
    await controller.reconcile(
      "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      {
        grantId: "81fe87eb-6c0f-47ca-93ca-9f9a038ca271",
        reason: "درخواست تطبیق دوباره نتیجه درگاه",
      },
      request,
    );

    expect(revealReview).toHaveBeenCalledWith({
      reviewId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      actorIdentityId: "27a3f408-858c-45d7-a0bd-ab84a28718ef",
      grantId: "81fe87eb-6c0f-47ca-93ca-9f9a038ca271",
      reason: "بررسی مدرک درگاه برای این پرونده پرداخت",
      correlationId: "request-151",
    });
    expect(requestReconciliation).toHaveBeenCalledWith({
      reviewId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      actorIdentityId: "27a3f408-858c-45d7-a0bd-ab84a28718ef",
      grantId: "81fe87eb-6c0f-47ca-93ca-9f9a038ca271",
      reason: "درخواست تطبیق دوباره نتیجه درگاه",
      correlationId: "request-151",
    });
  });
});
