import {
  directRefundContract,
  directRefundConfirmedV1Contract,
  directRefundFailedV1Contract,
  directRefundPendingV1Contract,
  recordDirectRefundResultInputContract,
  requestDirectRefundInputContract,
  directPaymentErrorContract,
  createDirectPaymentAttemptInputContract,
  directPaymentAttemptContract,
  directPaymentAttemptConfirmedV1Contract,
  directPaymentAttemptCreatedV1Contract,
  directPaymentAttemptDispatchedV1Contract,
  directPaymentAttemptFailedV1Contract,
  directPaymentAttemptReviewRequiredV1Contract,
  directPaymentAttemptStatusContract,
  directPaymentAttemptTerminalStatuses,
  paymentAttemptAuditContract,
  paymentsV1Operations,
  paymentReviewErrorContract,
  paymentReviewQueueContract,
  providerCallbackInputContract,
  providerCallbackResultContract,
} from "@sevo/contracts/payments/v1";
import {
  paymentsV2Operations,
  paymentReviewDetailV2Contract,
  paymentReviewRevealInputV2Contract,
  paymentReconciliationRequestV2Contract,
  paymentReviewQueueV2Contract,
} from "@sevo/contracts/payments/v2";
import { describe, expect, it } from "vitest";

describe("direct payment v1 contract", () => {
  it("publishes the direct-refund lifecycle without promising a guaranteed refund", () => {
    expect(paymentsV1Operations.requestDirectRefund).toEqual({
      operationId: "requestDirectRefund",
      method: "post",
      path: "/v1/seller/orders/{orderId}/direct-refund",
    });
    expect(paymentsV1Operations.readDirectRefund).toEqual({
      operationId: "readDirectRefund",
      method: "get",
      path: "/v1/seller/orders/{orderId}/direct-refund",
    });
    expect(paymentsV1Operations.recordDirectRefundResult).toEqual({
      operationId: "recordDirectRefundResult",
      method: "post",
      path: "/internal/v1/payment-providers/{provider}/direct-refunds",
    });
    expect(
      requestDirectRefundInputContract.parse({
        reason: "کالا پیش از ارسال قابل تأمین نیست.",
      }),
    ).toEqual({ reason: "کالا پیش از ارسال قابل تأمین نیست." });
    expect(
      recordDirectRefundResultInputContract.parse({
        paymentAttemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
        amount: { amount: 12_500_000, currency: "IRR" },
        result: "FAILED",
        evidenceReference: "provider-result-135-1",
      }),
    ).toEqual({
      paymentAttemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      amount: { amount: 12_500_000, currency: "IRR" },
      result: "FAILED",
      evidenceReference: "provider-result-135-1",
    });

    const pending = directRefundContract.parse({
      orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
      paymentAttemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      amount: { amount: 12_500_000, currency: "IRR" },
      status: "PENDING",
      orderStatus: "CANCELLATION_PENDING_REFUND",
      nextAction: "WAIT_FOR_VERIFICATION",
      updatedAt: "2026-08-31T08:00:00.000Z",
    });
    const failed = directRefundContract.parse({
      ...pending,
      status: "FAILED",
      nextAction: "RETRY_REFUND",
    });
    const confirmed = directRefundContract.parse({
      ...pending,
      status: "CONFIRMED",
      orderStatus: "CANCELLED",
      nextAction: "NONE",
    });
    expect([pending.nextAction, failed.nextAction, confirmed.nextAction]).toEqual([
      "WAIT_FOR_VERIFICATION",
      "RETRY_REFUND",
      "NONE",
    ]);

    const envelope = {
      eventId: "81fe87eb-6c0f-47ca-93ca-9f9a038ca271",
      version: 1 as const,
      aggregateId: pending.orderId,
      occurredAt: pending.updatedAt,
      correlationId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
      causationId: "61fe87eb-6c0f-47ca-93ca-9f9a038ca270",
      actor: { type: "IDENTITY" as const, id: "27a3f408-858c-45d7-a0bd-ab84a28718ef" },
    };
    expect(
      directRefundPendingV1Contract.parse({
        ...envelope,
        eventType: "DirectRefundPending.v1",
        aggregateVersion: 1,
        payload: {
          status: "PENDING",
          paymentAttemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
          amount: { amount: 12_500_000, currency: "IRR" },
        },
      }).payload,
    ).toEqual({
      status: "PENDING",
      paymentAttemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      amount: { amount: 12_500_000, currency: "IRR" },
    });
    expect(
      directRefundFailedV1Contract.parse({
        ...envelope,
        eventType: "DirectRefundFailed.v1",
        aggregateVersion: 2,
        payload: { status: "FAILED" },
      }).payload,
    ).toEqual({ status: "FAILED" });
    expect(
      directRefundConfirmedV1Contract.parse({
        ...envelope,
        eventType: "DirectRefundConfirmed.v1",
        aggregateVersion: 3,
        payload: { status: "CONFIRMED" },
      }).payload,
    ).toEqual({ status: "CONFIRMED" });
  });

  it("exposes actionable payment conflicts without leaking internals", () => {
    expect(
      directPaymentErrorContract.parse({
        code: "ORDER_NOT_PAYABLE",
        message: "مهلت یا وضعیت سفارش برای پرداخت آماده نیست.",
        correlationId: "browser-request-123",
      }),
    ).toMatchObject({ code: "ORDER_NOT_PAYABLE" });
    expect(
      paymentReviewErrorContract.parse({
        code: "PLATFORM_PERMISSION_REQUIRED",
        message: "مجوز بررسی عملیاتی برای این نشست فعال نیست.",
        correlationId: "browser-request-123",
      }),
    ).toMatchObject({ code: "PLATFORM_PERMISSION_REQUIRED" });
  });

  it("keeps the v1 queue compatible while v2 limits detail and scopes evidence", () => {
    const reviewId = "91fe87eb-6c0f-47ca-93ca-9f9a038ca273";
    expect(paymentsV2Operations.revealPlatformPaymentReview).toEqual({
      operationId: "revealPlatformPaymentReviewV2",
      method: "post",
      path: "/v2/platform/payment-reviews/{reviewId}/reveal",
    });
    expect(paymentsV2Operations.requestPlatformPaymentReconciliation).toEqual({
      operationId: "requestPlatformPaymentReconciliationV2",
      method: "post",
      path: "/v2/platform/payment-reviews/{reviewId}/reconciliation",
    });

    expect(
      paymentReviewQueueContract.parse({
        items: [
          {
            attempt: {
              attemptId: reviewId,
              orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
              status: "REVIEW_REQUIRED",
              amount: { amount: 4_500_000, currency: "IRR" },
              provider: "DEV",
              createdAt: "2026-08-25T08:00:00.000Z",
            },
            reviewKind: "RESULT_AMBIGUOUS",
            alertKinds: [],
            audits: [],
          },
        ],
      }).items[0],
    ).toHaveProperty("attempt");

    const queue = paymentReviewQueueV2Contract.parse({
      items: [
        {
          reviewId,
          reviewKind: "RESULT_AMBIGUOUS",
          amount: { amount: 4_500_000, currency: "IRR" },
          provider: "DEV",
          openedAt: "2026-08-25T08:01:00.000Z",
          needsFollowUp: true,
        },
      ],
    });
    expect(queue.items[0]).not.toHaveProperty("providerReference");
    expect(queue.items[0]).not.toHaveProperty("audits");
    expect(queue.items[0]).not.toHaveProperty("orderId");

    const input = paymentReviewRevealInputV2Contract.parse({
      grantId: "81fe87eb-6c0f-47ca-93ca-9f9a038ca271",
      reason: "بررسی مدرک درگاه برای این پرونده پرداخت",
    });
    expect(input.reason).toContain("مدرک");

    expect(
      paymentReviewDetailV2Contract.parse({
        reviewId,
        orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
        status: "REVIEW_REQUIRED",
        amount: { amount: 4_500_000, currency: "IRR" },
        provider: "DEV",
        providerReference: "provider-reference-151",
        reviewKind: "RESULT_AMBIGUOUS",
        alertKinds: ["RECONCILIATION_OVERDUE"],
        observations: [
          {
            providerEventId: "provider-event-151",
            providerReference: "provider-reference-151",
            result: "PENDING",
            observedAt: "2026-08-25T08:01:00.000Z",
          },
        ],
        audits: [
          {
            fromStatus: "DISPATCHED",
            toStatus: "REVIEW_REQUIRED",
            reasonCode: "PROVIDER_RESULT_PENDING",
            occurredAt: "2026-08-25T08:01:00.000Z",
          },
        ],
        reconciliationCount: 2,
        nextReconciliationAt: "2026-08-25T08:05:00.000Z",
        revealedAt: "2026-08-25T08:02:00.000Z",
        accessExpiresAt: "2026-08-25T08:30:00.000Z",
      }).observations,
    ).toHaveLength(1);
    expect(
      paymentReconciliationRequestV2Contract.parse({
        reviewId,
        requestedAt: "2026-08-25T08:02:00.000Z",
      }),
    ).toMatchObject({ reviewId });
  });

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
          "/v1/payment-providers/dev/pay/91fe87eb-6c0f-47ca-93ca-9f9a038ca273?scenario=success",
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
  });

  it("keeps operation paths, terminal states, audits, and events versioned", () => {
    expect(paymentsV1Operations.createDirectPaymentAttempt).toEqual({
      operationId: "createDirectPaymentAttempt",
      method: "post",
      path: "/v1/orders/{orderId}/payment-attempts",
    });
    expect(directPaymentAttemptStatusContract.options).toEqual([
      "CREATED",
      "DISPATCHED",
      "CONFIRMED",
      "FAILED",
      "REVIEW_REQUIRED",
    ]);
    expect(directPaymentAttemptTerminalStatuses).toEqual(["CONFIRMED", "FAILED"]);

    const envelope = {
      eventId: "81fe87eb-6c0f-47ca-93ca-9f9a038ca271",
      version: 1 as const,
      aggregateId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
      occurredAt: "2026-08-25T08:01:00.000Z",
      correlationId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
      causationId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
    };
    const amount = { amount: 4_500_000, currency: "IRR" } as const;
    const events = [
      directPaymentAttemptCreatedV1Contract.parse({
        ...envelope,
        eventType: "DirectPaymentAttemptCreated.v1",
        aggregateVersion: 1,
        actor: { type: "IDENTITY", id: "27a3f408-858c-45d7-a0bd-ab84a28718ef" },
        payload: { status: "CREATED", amount },
      }),
      directPaymentAttemptDispatchedV1Contract.parse({
        ...envelope,
        eventType: "DirectPaymentAttemptDispatched.v1",
        aggregateVersion: 2,
        actor: { type: "SYSTEM" },
        payload: { status: "DISPATCHED" },
      }),
      directPaymentAttemptConfirmedV1Contract.parse({
        ...envelope,
        eventType: "DirectPaymentAttemptConfirmed.v1",
        aggregateVersion: 3,
        actor: { type: "SYSTEM" },
        payload: { status: "CONFIRMED", amount },
      }),
      directPaymentAttemptReviewRequiredV1Contract.parse({
        ...envelope,
        eventType: "DirectPaymentAttemptReviewRequired.v1",
        aggregateVersion: 3,
        actor: { type: "SYSTEM" },
        payload: { status: "REVIEW_REQUIRED" },
      }),
    ];
    expect(events.map((event) => event.eventType)).toEqual([
      "DirectPaymentAttemptCreated.v1",
      "DirectPaymentAttemptDispatched.v1",
      "DirectPaymentAttemptConfirmed.v1",
      "DirectPaymentAttemptReviewRequired.v1",
    ]);
    const audit = {
      attemptId: envelope.aggregateId,
      fromStatus: "DISPATCHED",
      toStatus: "CONFIRMED",
      reasonCode: "PROVIDER_CONFIRMED",
      actorKind: "PAYMENTS_SERVICE",
      correlationId: envelope.correlationId,
      occurredAt: envelope.occurredAt,
    } as const;
    expect(paymentAttemptAuditContract.parse(audit)).toEqual(audit);
    expect(
      paymentAttemptAuditContract.safeParse({
        ...audit,
        providerMetadata: { rawStatus: "sensitive" },
      }).success,
    ).toBe(false);
  });
});
