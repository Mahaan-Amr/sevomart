import { describe, expect, it } from "vitest";
import {
  paymentReviewDetailV3Contract,
  paymentReviewRevealInputV3Contract,
  paymentsV3Examples,
} from "@sevo/contracts/payments/v3";
import {
  platformDisputeDirectViewContract,
  platformViolationDirectViewContract,
  problemFollowUpV3Examples,
} from "@sevo/contracts/problem-follow-up/v3";

describe("superadmin direct access contracts", () => {
  it("accepts reason-only requests and role receipts without fabricated grants or expirations", () => {
    expect(
      paymentReviewRevealInputV3Contract.safeParse(
        paymentsV3Examples.PaymentReviewRevealInputV3,
      ).success,
    ).toBe(true);
    expect(
      paymentReviewDetailV3Contract.safeParse(paymentsV3Examples.PaymentReviewDetailV3)
        .success,
    ).toBe(true);
    expect(
      platformDisputeDirectViewContract.safeParse(
        problemFollowUpV3Examples.PlatformDisputeDirectViewV3,
      ).success,
    ).toBe(true);
    expect(
      platformViolationDirectViewContract.safeParse(
        problemFollowUpV3Examples.PlatformViolationDirectViewV3,
      ).success,
    ).toBe(true);
    expect(
      paymentReviewDetailV3Contract.safeParse({
        ...paymentsV3Examples.PaymentReviewDetailV3,
        accessExpiresAt: "2026-08-26T10:30:00.000Z",
      }).success,
    ).toBe(false);
  });
  it("rejects a receipt for a different case", () => {
    const input = paymentsV3Examples.PaymentReviewDetailV3;
    expect(
      paymentReviewDetailV3Contract.safeParse({
        ...input,
        reviewId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }).success,
    ).toBe(false);
  });
});
