import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import {
  directPaymentAttemptStatusContract,
  paymentAttemptAuditContract,
} from "../v1/index";
import {
  moneyV1Contract,
  orderIdContract,
  paymentAttemptIdContract,
} from "../../platform/v1/index";

export const paymentsV2Operations = {
  listPlatformPaymentReviews: {
    operationId: "listPlatformPaymentReviewsV2",
    method: "get",
    path: "/v2/platform/payment-reviews",
  },
  revealPlatformPaymentReview: {
    operationId: "revealPlatformPaymentReviewV2",
    method: "post",
    path: "/v2/platform/payment-reviews/{reviewId}/reveal",
  },
  requestPlatformPaymentReconciliation: {
    operationId: "requestPlatformPaymentReconciliationV2",
    method: "post",
    path: "/v2/platform/payment-reviews/{reviewId}/reconciliation",
  },
} as const;

export const paymentReviewErrorV2Contract = z
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

export const paymentReviewKindV2Contract = z.enum([
  "RESULT_AMBIGUOUS",
  "PAID_STOCK_CONFLICT",
  "PROVIDER_CONFLICT",
]);

export const paymentReviewAlertKindV2Contract = z.enum([
  "RECONCILIATION_OVERDUE",
  "PAID_STOCK_CONFLICT",
  "PROVIDER_AMOUNT_MISMATCH",
  "PROVIDER_RESULT_CONTRADICTION",
]);

export const paymentReviewItemV2Contract = z
  .object({
    reviewId: paymentAttemptIdContract,
    reviewKind: paymentReviewKindV2Contract,
    amount: moneyV1Contract,
    provider: z.string().min(1).max(24),
    openedAt: z.iso.datetime({ offset: true }),
    needsFollowUp: z.boolean(),
  })
  .strict();

export const paymentReviewQueueV2Contract = z
  .object({ items: z.array(paymentReviewItemV2Contract).readonly() })
  .strict();

export const paymentReviewRevealInputV2Contract = z
  .object({
    grantId: z.uuid(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export const paymentReconciliationRequestInputV2Contract = z
  .object({
    grantId: z.uuid(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export const paymentProviderObservationV2Contract = z
  .object({
    providerEventId: z.string().min(1).max(128),
    providerReference: z.string().min(1).max(128),
    result: z.enum(["CONFIRMED", "FAILED", "PENDING"]),
    observedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const paymentAttemptAuditSummaryV2Contract = paymentAttemptAuditContract.omit({
  attemptId: true,
  actorKind: true,
  correlationId: true,
});

export const paymentReviewDetailV2Contract = z
  .object({
    reviewId: paymentAttemptIdContract,
    orderId: orderIdContract,
    status: directPaymentAttemptStatusContract,
    amount: moneyV1Contract,
    provider: z.string().min(1).max(24),
    providerReference: z.string().min(1).max(128).optional(),
    reviewKind: paymentReviewKindV2Contract,
    alertKinds: z.array(paymentReviewAlertKindV2Contract).readonly(),
    observations: z.array(paymentProviderObservationV2Contract).readonly(),
    audits: z.array(paymentAttemptAuditSummaryV2Contract).readonly(),
    reconciliationCount: z.int().nonnegative(),
    nextReconciliationAt: z.iso.datetime({ offset: true }).optional(),
    revealedAt: z.iso.datetime({ offset: true }),
    accessExpiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const paymentReconciliationRequestV2Contract = z
  .object({
    reviewId: paymentAttemptIdContract,
    requestedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const paymentsV2Schemas = {
  PaymentReviewQueueV2: paymentReviewQueueV2Contract,
  PaymentReviewRevealInputV2: paymentReviewRevealInputV2Contract,
  PaymentReviewDetailV2: paymentReviewDetailV2Contract,
  PaymentReconciliationRequestInputV2: paymentReconciliationRequestInputV2Contract,
  PaymentReconciliationRequestV2: paymentReconciliationRequestV2Contract,
  PaymentReviewErrorV2: paymentReviewErrorV2Contract,
} as const;

export function createPaymentsV2JsonSchemas() {
  return createJsonSchemaMap(paymentsV2Schemas);
}

export const paymentsV2Examples = {
  PaymentReviewRevealInputV2: {
    grantId: "81fe87eb-6c0f-47ca-93ca-9f9a038ca271",
    reason: "بررسی مدرک درگاه برای این پرونده پرداخت",
  },
  PaymentReconciliationRequestInputV2: {
    grantId: "81fe87eb-6c0f-47ca-93ca-9f9a038ca271",
    reason: "درخواست تطبیق دوباره نتیجه درگاه",
  },
} as const;

export type PaymentReviewItemV2 = z.infer<typeof paymentReviewItemV2Contract>;
export type PaymentReviewDetailV2 = z.infer<typeof paymentReviewDetailV2Contract>;
