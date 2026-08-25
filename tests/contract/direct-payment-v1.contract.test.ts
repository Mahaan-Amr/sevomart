import {
  createDirectPaymentAttemptInputContract,
  directPaymentAttemptContract,
  directPaymentAttemptFailedV1Contract,
  paymentReviewQueueContract,
  providerCallbackInputContract,
  providerCallbackResultContract,
} from "@sevo/contracts/payments/v1";
import { describe, expect, it } from "vitest";

describe("direct payment v1 contract", () => {
  it("keeps payment attempts and verified callbacks free of raw tokens and PII", () => {
    expect(createDirectPaymentAttemptInputContract.parse({})).toEqual({});
    expect(
      directPaymentAttemptContract.parse({
        attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
        orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
        status: "DISPATCHED",
        amount: { amount: 4_500_000, currency: "IRR" },
        provider: "DEV",
        redirectUrl:
          "/v1/payment-providers/dev/pay/91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
        createdAt: "2026-08-25T08:00:00.000Z",
      }),
    ).not.toHaveProperty("token");

    const callback = providerCallbackInputContract.parse({
      attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
      amount: 4_500_000,
      result: "CONFIRMED",
      providerEventId: "dev-event-1",
      signature: "a".repeat(64),
    });
    expect(
      providerCallbackResultContract.parse({
        attemptId: callback.attemptId,
        status: "CONFIRMED",
        duplicate: false,
      }),
    ).toEqual({
      attemptId: callback.attemptId,
      status: "CONFIRMED",
      duplicate: false,
    });
    expect(
      providerCallbackResultContract.parse({
        attemptId: callback.attemptId,
        status: "REVIEW_REQUIRED",
        duplicate: false,
      }).status,
    ).toBe("REVIEW_REQUIRED");
    expect(
      directPaymentAttemptFailedV1Contract.parse({
        eventId: "81fe87eb-6c0f-47ca-93ca-9f9a038ca271",
        version: 1,
        eventType: "DirectPaymentAttemptFailed.v1",
        aggregateId: callback.attemptId,
        aggregateVersion: 3,
        occurredAt: "2026-08-25T08:01:00.000Z",
        correlationId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
        causationId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
        actor: { type: "SYSTEM" },
        payload: {
          status: "FAILED",
          amount: { amount: 4_500_000, currency: "IRR" },
        },
      }).payload.status,
    ).toBe("FAILED");
    expect(
      paymentReviewQueueContract.parse({
        items: [
          {
            attempt: {
              attemptId: callback.attemptId,
              orderId: callback.orderId,
              status: "REVIEW_REQUIRED",
              amount: { amount: callback.amount, currency: "IRR" },
              provider: "DEV",
              createdAt: "2026-08-25T08:00:00.000Z",
            },
            reviewKind: "RESULT_AMBIGUOUS",
            alertKinds: ["RECONCILIATION_OVERDUE"],
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
        ],
      }).items[0]?.alertKinds,
    ).toEqual(["RECONCILIATION_OVERDUE"]);
  });
});
