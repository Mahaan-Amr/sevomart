import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import { orderStatusContract } from "../../orders/v1/index";
import {
  eventActorV1Contract,
  eventEnvelopeV1Contract,
  moneyV1Contract,
  orderIdContract,
  paymentAttemptIdContract,
} from "../../platform/v1/index";

export const paymentsV1Operations = {
  createDirectPaymentAttempt: {
    operationId: "createDirectPaymentAttempt",
    method: "post",
    path: "/v1/orders/{orderId}/payment-attempts",
  },
  readDirectPaymentAttempt: {
    operationId: "readDirectPaymentAttempt",
    method: "get",
    path: "/v1/payment-attempts/{attemptId}",
  },
  acceptDevPaymentCallback: {
    operationId: "acceptDevPaymentCallback",
    method: "post",
    path: "/internal/v1/payment-providers/{provider}/callbacks",
  },
  listPlatformPaymentReviews: {
    operationId: "listPlatformPaymentReviews",
    method: "get",
    path: "/v1/platform/payment-reviews",
  },
  revealPlatformPaymentReview: {
    operationId: "revealPlatformPaymentReview",
    method: "post",
    path: "/v1/platform/payment-reviews/{reviewId}/reveal",
  },
  requestPlatformPaymentReconciliation: {
    operationId: "requestPlatformPaymentReconciliation",
    method: "post",
    path: "/v1/platform/payment-reviews/{reviewId}/reconciliation",
  },
  requestDirectRefund: {
    operationId: "requestDirectRefund",
    method: "post",
    path: "/v1/seller/orders/{orderId}/direct-refund",
  },
  readDirectRefund: {
    operationId: "readDirectRefund",
    method: "get",
    path: "/v1/seller/orders/{orderId}/direct-refund",
  },
  recordDirectRefundResult: {
    operationId: "recordDirectRefundResult",
    method: "post",
    path: "/internal/v1/payment-providers/{provider}/direct-refunds",
  },
} as const;

export const requestDirectRefundInputContract = z
  .object({ reason: z.string().trim().min(8).max(500) })
  .strict();
export const recordDirectRefundResultInputContract = z
  .object({
    paymentAttemptId: paymentAttemptIdContract,
    amount: moneyV1Contract,
    result: z.enum(["CONFIRMED", "FAILED"]),
    evidenceReference: z.string().trim().min(3).max(200),
  })
  .strict();
export const providerRefundCallbackInputContract = recordDirectRefundResultInputContract
  .extend({
    orderId: orderIdContract,
    providerEventId: z.string().trim().min(1).max(200),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const directRefundStatusContract = z.enum(["PENDING", "FAILED", "CONFIRMED"]);
export const directRefundContract = z
  .object({
    orderId: orderIdContract,
    paymentAttemptId: paymentAttemptIdContract,
    amount: moneyV1Contract,
    status: directRefundStatusContract,
    orderStatus: z.enum(["CANCELLATION_PENDING_REFUND", "CANCELLED"]),
    nextAction: z.enum(["WAIT_FOR_VERIFICATION", "RETRY_REFUND", "NONE"]),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const directRefundErrorContract = z
  .object({
    code: z.enum([
      "FORBIDDEN",
      "REFUND_NOT_FOUND",
      "CANCELLATION_NOT_ALLOWED",
      "INVALID_REFUND_TRANSITION",
      "REFUND_AMOUNT_MISMATCH",
      "REFUND_EVIDENCE_REQUIRED",
      "DUPLICATE_RESULT",
      "IDEMPOTENCY_CONFLICT",
      "IDEMPOTENCY_IN_PROGRESS",
      "PRECONDITION_REQUIRED",
      "VALIDATION_ERROR",
    ]),
    message: z.string().min(1),
    correlationId: z.string().min(1),
  })
  .strict();

export const directRefundPendingV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DirectRefundPending.v1"),
  causationId: z.uuid(),
  actor: eventActorV1Contract,
  payload: z
    .object({
      status: z.literal("PENDING"),
      paymentAttemptId: paymentAttemptIdContract,
      amount: moneyV1Contract,
    })
    .strict(),
});
export const directRefundConfirmedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DirectRefundConfirmed.v1"),
  causationId: z.uuid(),
  actor: eventActorV1Contract,
  payload: z.object({ status: z.literal("CONFIRMED") }).strict(),
});
export const directRefundFailedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DirectRefundFailed.v1"),
  causationId: z.uuid(),
  actor: eventActorV1Contract,
  payload: z.object({ status: z.literal("FAILED") }).strict(),
});

export const createDirectPaymentAttemptInputContract = z.object({}).strict();
export const paymentIdempotencyKeyContract = z.string().min(1).max(200);

export const directPaymentAttemptStatusContract = z.enum([
  "CREATED",
  "DISPATCHED",
  "CONFIRMED",
  "FAILED",
  "REVIEW_REQUIRED",
]);
export const directPaymentAttemptTerminalStatuses = [
  "CONFIRMED",
  "FAILED",
] as const satisfies readonly z.infer<typeof directPaymentAttemptStatusContract>[];

export const directPaymentAttemptContract = z
  .object({
    attemptId: paymentAttemptIdContract,
    orderId: orderIdContract,
    status: directPaymentAttemptStatusContract,
    amount: moneyV1Contract,
    provider: z.string().min(1).max(24),
    redirectUrl: z.string().min(1).max(500).optional(),
    providerReference: z.string().min(1).max(128).optional(),
    createdAt: z.iso.datetime({ offset: true }),
    confirmedAt: z.iso.datetime({ offset: true }).optional(),
    orderStatus: orderStatusContract.optional(),
    reservationExpiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const providerCallbackInputContract = z
  .object({
    attemptId: paymentAttemptIdContract,
    orderId: orderIdContract,
    amount: z.int().nonnegative(),
    result: z.enum(["CONFIRMED", "FAILED", "PENDING"]),
    providerEventId: z.string().min(1).max(128),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const providerCallbackResultContract = z
  .object({
    attemptId: paymentAttemptIdContract,
    status: z.enum(["CONFIRMED", "FAILED", "REVIEW_REQUIRED"]),
    duplicate: z.boolean(),
  })
  .strict();

export const directPaymentErrorContract = z
  .object({
    code: z.enum([
      "ORDER_NOT_PAYABLE",
      "IDEMPOTENCY_CONFLICT",
      "IDEMPOTENCY_IN_PROGRESS",
      "AMOUNT_MISMATCH",
      "ATTEMPT_NOT_FOUND",
      "INVALID_CALLBACK",
      "PRECONDITION_REQUIRED",
    ]),
    message: z.string().min(1),
    correlationId: z.string().min(1),
  })
  .strict();

export const paymentReviewErrorContract = z
  .object({
    code: z.enum([
      "PLATFORM_PERMISSION_REQUIRED",
      "RESPONSIBILITY_REQUIRED",
      "SENSITIVE_SCOPE_REQUIRED",
      "REVIEW_NOT_FOUND",
      "RECONCILIATION_NOT_AVAILABLE",
      "VALIDATION_ERROR",
    ]),
    message: z.string().min(1),
    correlationId: z.string().min(1),
  })
  .strict();

export const directPaymentAttemptConfirmedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DirectPaymentAttemptConfirmed.v1"),
  causationId: z.uuid(),
  actor: eventActorV1Contract,
  payload: z
    .object({
      status: z.literal("CONFIRMED"),
      amount: moneyV1Contract,
    })
    .strict(),
});

export const directPaymentAttemptFailedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DirectPaymentAttemptFailed.v1"),
  causationId: z.uuid(),
  actor: z.object({ type: z.literal("SYSTEM") }).strict(),
  payload: z.object({ status: z.literal("FAILED"), amount: moneyV1Contract }).strict(),
});

export const directPaymentAttemptCreatedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DirectPaymentAttemptCreated.v1"),
  causationId: z.uuid(),
  actor: eventActorV1Contract,
  payload: z.object({ status: z.literal("CREATED"), amount: moneyV1Contract }).strict(),
});

export const directPaymentAttemptDispatchedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DirectPaymentAttemptDispatched.v1"),
  causationId: z.uuid(),
  actor: z.object({ type: z.literal("SYSTEM") }).strict(),
  payload: z.object({ status: z.literal("DISPATCHED") }).strict(),
});

export const directPaymentAttemptReviewRequiredV1Contract =
  eventEnvelopeV1Contract.extend({
    eventType: z.literal("DirectPaymentAttemptReviewRequired.v1"),
    causationId: z.uuid(),
    actor: z.object({ type: z.literal("SYSTEM") }).strict(),
    payload: z.object({ status: z.literal("REVIEW_REQUIRED") }).strict(),
  });

export const paymentAttemptAuditReasonCodeContract = z.enum([
  "PAYMENT_ATTEMPT_CREATED",
  "PROVIDER_DISPATCH_CLAIMED",
  "DISPATCH_LEASE_EXPIRED",
  "DISPATCH_NOT_STARTED_BEFORE_LEASE_EXPIRY",
  "PROVIDER_FAILED",
  "PROVIDER_RESULT_PENDING",
  "PROVIDER_INITIATION_OUTCOME_UNKNOWN",
  "PROVIDER_CONFIRMED",
  "PAID_STOCK_CONFLICT",
  "PROVIDER_AMOUNT_MISMATCH",
  "DUPLICATE_PROVIDER_EVENT_AMOUNT_MISMATCH",
  "DUPLICATE_PROVIDER_EVENT_RESULT_CONFLICT",
  "PROVIDER_RESULT_CONTRADICTS_CONFIRMED",
  "PROVIDER_RESULT_CONTRADICTS_FAILED",
  "PROVIDER_REFERENCE_RECOVERED",
]);

export const paymentAttemptAuditContract = z
  .object({
    attemptId: paymentAttemptIdContract,
    fromStatus: directPaymentAttemptStatusContract.nullable(),
    toStatus: directPaymentAttemptStatusContract,
    reasonCode: paymentAttemptAuditReasonCodeContract,
    actorKind: z.literal("PAYMENTS_SERVICE"),
    correlationId: z.string().min(1).max(128),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const paymentAttemptAuditSummaryContract = paymentAttemptAuditContract.omit({
  attemptId: true,
  actorKind: true,
  correlationId: true,
});

export const paymentReviewKindContract = z.enum([
  "RESULT_AMBIGUOUS",
  "PAID_STOCK_CONFLICT",
  "PROVIDER_CONFLICT",
]);

export const paymentReviewAlertKindContract = z.enum([
  "RECONCILIATION_OVERDUE",
  "PAID_STOCK_CONFLICT",
  "PROVIDER_AMOUNT_MISMATCH",
  "PROVIDER_RESULT_CONTRADICTION",
]);

export const paymentReviewItemContract = z
  .object({
    reviewId: paymentAttemptIdContract,
    reviewKind: paymentReviewKindContract,
    amount: moneyV1Contract,
    provider: z.string().min(1).max(24),
    openedAt: z.iso.datetime({ offset: true }),
    needsFollowUp: z.boolean(),
  })
  .strict();

export const paymentReviewQueueContract = z
  .object({ items: z.array(paymentReviewItemContract).readonly() })
  .strict();

export const paymentReviewRevealInputContract = z
  .object({
    grantId: z.uuid(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export const paymentReconciliationRequestInputContract = z
  .object({ reason: z.string().trim().min(8).max(500) })
  .strict();

export const paymentProviderObservationContract = z
  .object({
    providerEventId: z.string().min(1).max(128),
    providerReference: z.string().min(1).max(128),
    result: z.enum(["CONFIRMED", "FAILED", "PENDING"]),
    observedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const paymentReviewDetailContract = z
  .object({
    reviewId: paymentAttemptIdContract,
    orderId: orderIdContract,
    status: directPaymentAttemptStatusContract,
    amount: moneyV1Contract,
    provider: z.string().min(1).max(24),
    providerReference: z.string().min(1).max(128).optional(),
    reviewKind: paymentReviewKindContract,
    alertKinds: z.array(paymentReviewAlertKindContract).readonly(),
    observations: z.array(paymentProviderObservationContract).readonly(),
    audits: z.array(paymentAttemptAuditSummaryContract).readonly(),
    reconciliationCount: z.int().nonnegative(),
    nextReconciliationAt: z.iso.datetime({ offset: true }).optional(),
    revealedAt: z.iso.datetime({ offset: true }).optional(),
    accessExpiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const paymentReconciliationRequestContract = z
  .object({
    reviewId: paymentAttemptIdContract,
    requestedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const paymentsV1Schemas = {
  RequestDirectRefundInput: requestDirectRefundInputContract,
  RecordDirectRefundResultInput: recordDirectRefundResultInputContract,
  ProviderRefundCallbackInput: providerRefundCallbackInputContract,
  DirectRefund: directRefundContract,
  DirectRefundStatus: directRefundStatusContract,
  DirectRefundError: directRefundErrorContract,
  DirectRefundPendingV1: directRefundPendingV1Contract,
  DirectRefundConfirmedV1: directRefundConfirmedV1Contract,
  DirectRefundFailedV1: directRefundFailedV1Contract,
  OrderId: orderIdContract,
  PaymentAttemptId: paymentAttemptIdContract,
  IdempotencyKey: paymentIdempotencyKeyContract,
  PaymentProviderKey: z.string().min(1).max(24),
  CreateDirectPaymentAttemptInput: createDirectPaymentAttemptInputContract,
  DirectPaymentAttempt: directPaymentAttemptContract,
  ProviderCallbackInput: providerCallbackInputContract,
  ProviderCallbackResult: providerCallbackResultContract,
  PaymentReviewQueue: paymentReviewQueueContract,
  PaymentReviewRevealInput: paymentReviewRevealInputContract,
  PaymentReviewDetail: paymentReviewDetailContract,
  PaymentReconciliationRequestInput: paymentReconciliationRequestInputContract,
  PaymentReconciliationRequest: paymentReconciliationRequestContract,
  PaymentReviewError: paymentReviewErrorContract,
  DirectPaymentError: directPaymentErrorContract,
  DirectPaymentAttemptStatus: directPaymentAttemptStatusContract,
  PaymentAttemptAuditReasonCode: paymentAttemptAuditReasonCodeContract,
  PaymentAttemptAudit: paymentAttemptAuditContract,
  DirectPaymentAttemptCreatedV1: directPaymentAttemptCreatedV1Contract,
  DirectPaymentAttemptDispatchedV1: directPaymentAttemptDispatchedV1Contract,
  DirectPaymentAttemptConfirmedV1: directPaymentAttemptConfirmedV1Contract,
  DirectPaymentAttemptFailedV1: directPaymentAttemptFailedV1Contract,
  DirectPaymentAttemptReviewRequiredV1: directPaymentAttemptReviewRequiredV1Contract,
} as const;

export function createPaymentsV1JsonSchemas() {
  return createJsonSchemaMap(paymentsV1Schemas);
}

export const paymentsV1Examples = {
  RequestDirectRefundInput: {
    reason: "کالا پیش از ارسال قابل تأمین نیست.",
  },
  RecordDirectRefundResultInput: {
    paymentAttemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    amount: { amount: 12_500_000, currency: "IRR" },
    result: "CONFIRMED",
    evidenceReference: "provider-result-135-2",
  },
  ProviderRefundCallbackInput: {
    paymentAttemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    amount: { amount: 12_500_000, currency: "IRR" },
    result: "CONFIRMED",
    evidenceReference: "provider-result-135-2",
    providerEventId: "provider-refund-event-135-2",
    signature: "a".repeat(64),
  },
  DirectRefund: {
    orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    paymentAttemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    amount: { amount: 12_500_000, currency: "IRR" },
    status: "PENDING",
    orderStatus: "CANCELLATION_PENDING_REFUND",
    nextAction: "WAIT_FOR_VERIFICATION",
    updatedAt: "2026-08-31T08:00:00.000Z",
  },
  DirectRefundError: {
    code: "CANCELLATION_NOT_ALLOWED",
    message: "پس از ارسال، لغو و بازپرداخت از این مسیر ممکن نیست.",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
  CreateDirectPaymentAttemptInput: {},
  DirectPaymentAttempt: {
    attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    status: "DISPATCHED",
    amount: { amount: 4_500_000, currency: "IRR" },
    provider: "DEV",
    redirectUrl: "/v1/payment-providers/dev/pay/91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    createdAt: "2026-08-25T08:00:00.000Z",
  },
  ProviderCallbackInput: {
    attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    amount: 4_500_000,
    result: "CONFIRMED",
    providerEventId: "dev-event-1",
    signature: "a".repeat(64),
  },
  ProviderCallbackResult: {
    attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    status: "CONFIRMED",
    duplicate: false,
  },
  PaymentReviewError: {
    code: "PLATFORM_PERMISSION_REQUIRED",
    message: "مجوز بررسی عملیاتی برای این نشست فعال نیست.",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
  PaymentReviewRevealInput: {
    grantId: "81fe87eb-6c0f-47ca-93ca-9f9a038ca271",
    reason: "بررسی مدرک درگاه برای این پرونده پرداخت",
  },
  PaymentReconciliationRequestInput: {
    reason: "درخواست تطبیق دوباره نتیجه درگاه",
  },
} as const;

export type DirectPaymentAttempt = z.infer<typeof directPaymentAttemptContract>;
export type DirectRefund = z.infer<typeof directRefundContract>;
export type DirectRefundStatus = z.infer<typeof directRefundStatusContract>;
export type RequestDirectRefundInput = z.infer<typeof requestDirectRefundInputContract>;
export type RecordDirectRefundResultInput = z.infer<
  typeof recordDirectRefundResultInputContract
>;
export type ProviderRefundCallbackInput = z.infer<
  typeof providerRefundCallbackInputContract
>;
export type DirectPaymentAttemptStatus = z.infer<
  typeof directPaymentAttemptStatusContract
>;
export type PaymentAttemptAuditReasonCode = z.infer<
  typeof paymentAttemptAuditReasonCodeContract
>;
export type ProviderCallbackInput = z.infer<typeof providerCallbackInputContract>;
export type ProviderCallbackResult = z.infer<typeof providerCallbackResultContract>;
export type PaymentReviewItem = z.infer<typeof paymentReviewItemContract>;
export type PaymentReviewQueue = z.infer<typeof paymentReviewQueueContract>;
export type PaymentReviewRevealInput = z.infer<typeof paymentReviewRevealInputContract>;
export type PaymentReviewDetail = z.infer<typeof paymentReviewDetailContract>;
