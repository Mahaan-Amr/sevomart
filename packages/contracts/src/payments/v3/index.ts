import { z } from "zod";
import { paymentReviewDetailV2Contract } from "../v2/index";
import {
  superadminSensitiveReceiptContract,
  superadminRevocationInputContract,
  platformAccessV1Examples,
} from "../../identity-access/v1/platform-access";
import { createJsonSchemaMap } from "../../json-schema";

export const paymentReviewRevealInputV3Contract = superadminRevocationInputContract;
export const paymentReviewDetailV3Contract = paymentReviewDetailV2Contract
  .omit({ accessExpiresAt: true })
  .extend({ access: superadminSensitiveReceiptContract })
  .strict()
  .refine(
    (view) =>
      view.access.scope.resourceType === "PAYMENT_REVIEW" &&
      view.access.scope.resourceId === view.reviewId &&
      view.access.scope.allowedActions[0] === "REVEAL_MINIMUM",
    { path: ["access"], message: "access must match the payment review" },
  );
export type PaymentReviewDetailV3 = z.infer<typeof paymentReviewDetailV3Contract>;
export const paymentsV3Operations = {
  revealPlatformPaymentReview: {
    operationId: "revealPlatformPaymentReviewV3",
    method: "post",
    path: "/v3/platform/payment-reviews/{reviewId}/reveal",
  },
  requestPlatformPaymentReconciliation: {
    operationId: "requestPlatformPaymentReconciliationV3",
    method: "post",
    path: "/v3/platform/payment-reviews/{reviewId}/reconciliation",
  },
} as const;
export const paymentsV3Schemas = {
  PaymentReviewRevealInputV3: paymentReviewRevealInputV3Contract,
  PaymentReviewDetailV3: paymentReviewDetailV3Contract,
};
export const paymentsV3Examples = {
  PaymentReviewRevealInputV3: platformAccessV1Examples.SuperadminRevocationInput,
  PaymentReviewDetailV3: {
    reviewId: "55555555-5555-4555-8555-555555555555",
    orderId: "77777777-7777-4777-8777-777777777777",
    status: "REVIEW_REQUIRED",
    amount: { amount: 4500000, currency: "IRR" },
    provider: "DEV",
    reviewKind: "RESULT_AMBIGUOUS",
    alertKinds: [],
    observations: [],
    audits: [],
    reconciliationCount: 0,
    revealedAt: "2026-08-26T10:02:00.000Z",
    access: platformAccessV1Examples.SuperadminSensitiveReceipt,
  },
};
export function createPaymentsV3JsonSchemas() {
  return createJsonSchemaMap(paymentsV3Schemas);
}
