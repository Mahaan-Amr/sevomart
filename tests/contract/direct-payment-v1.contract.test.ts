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
    expect(
      paymentReviewQueueContract.parse({
        items: [
          {
            attempt: {
              attemptId: callback.attemptId,
              orderId: callback.orderId,
              status: "FAILED",
              amount: { amount: callback.amount, currency: "IRR" },
              provider: "DEV",
              createdAt: "2026-08-25T08:00:00.000Z",
            },
            reviewKind: "PROVIDER_CONFLICT",
            alertKinds: ["PROVIDER_RESULT_CONTRADICTION"],
            audits: [],
          },
        ],
      }).items[0]?.reviewKind,
    ).toBe("PROVIDER_CONFLICT");
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
