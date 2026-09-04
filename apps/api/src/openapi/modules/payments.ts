import {
  createPaymentsV1JsonSchemas,
  paymentsV1Examples,
  paymentsV1Operations,
} from "@sevo/contracts/payments/v1";
import {
  createPaymentsV2JsonSchemas,
  paymentsV2Examples,
  paymentsV2Operations,
} from "@sevo/contracts/payments/v2";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const operations = [
  {
    ...paymentsV1Operations.readBuyerDirectRefund,
    tag: "payments",
    auth: "identity-session",
    pathParameter: {
      name: "orderId",
      schema: "OrderId",
      example: paymentsV1Examples.DirectRefund.orderId,
    },
    responses: [
      { status: 200, schema: "DirectRefund" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "DirectRefundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...paymentsV1Operations.createDirectPaymentAttempt,
    tag: "payments",
    auth: "identity-session",
    pathParameter: {
      name: "orderId",
      schema: "OrderId",
      example: paymentsV1Examples.DirectPaymentAttempt.orderId,
    },
    headerParameters: [
      {
        name: "Idempotency-Key",
        schema: "IdempotencyKey",
        example: "pay-order-01",
        required: true,
      },
    ],
    request: {
      schema: "CreateDirectPaymentAttemptInput",
      example: paymentsV1Examples.CreateDirectPaymentAttemptInput,
    },
    responses: [
      { status: 201, schema: "DirectPaymentAttempt" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 409, schema: "DirectPaymentError" },
      { status: 428, schema: "DirectPaymentError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...paymentsV1Operations.readDirectPaymentAttempt,
    tag: "payments",
    auth: "identity-session",
    pathParameter: {
      name: "attemptId",
      schema: "PaymentAttemptId",
      example: paymentsV1Examples.DirectPaymentAttempt.attemptId,
    },
    responses: [
      { status: 200, schema: "DirectPaymentAttempt" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "DirectPaymentError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...paymentsV1Operations.acceptDevPaymentCallback,
    tag: "payments",
    auth: "none",
    pathParameter: {
      name: "provider",
      schema: "PaymentProviderKey",
      example: "DEV",
    },
    request: {
      schema: "ProviderCallbackInput",
      example: paymentsV1Examples.ProviderCallbackInput,
    },
    responses: [
      { status: 200, schema: "ProviderCallbackResult" },
      { status: 422, schema: "DirectPaymentError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...paymentsV2Operations.listPlatformPaymentReviews,
    tag: "payments",
    auth: "platform-agent-session",
    responses: [
      { status: 200, schema: "PaymentReviewQueueV2" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "PaymentReviewErrorV2" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...paymentsV2Operations.revealPlatformPaymentReview,
    tag: "payments",
    auth: "platform-agent-session",
    pathParameter: {
      name: "reviewId",
      schema: "PaymentAttemptId",
      example: paymentsV1Examples.DirectPaymentAttempt.attemptId,
    },
    request: {
      schema: "PaymentReviewRevealInputV2",
      example: paymentsV2Examples.PaymentReviewRevealInputV2,
    },
    responses: [
      { status: 200, schema: "PaymentReviewDetailV2" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "PaymentReviewErrorV2" },
      { status: 404, schema: "PaymentReviewErrorV2" },
      { status: 422, schema: "PaymentReviewErrorV2" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...paymentsV2Operations.requestPlatformPaymentReconciliation,
    tag: "payments",
    auth: "platform-agent-session",
    pathParameter: {
      name: "reviewId",
      schema: "PaymentAttemptId",
      example: paymentsV1Examples.DirectPaymentAttempt.attemptId,
    },
    request: {
      schema: "PaymentReconciliationRequestInputV2",
      example: paymentsV2Examples.PaymentReconciliationRequestInputV2,
    },
    responses: [
      { status: 202, schema: "PaymentReconciliationRequestV2" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "PaymentReviewErrorV2" },
      { status: 409, schema: "PaymentReviewErrorV2" },
      { status: 422, schema: "PaymentReviewErrorV2" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...paymentsV1Operations.requestDirectRefund,
    tag: "payments",
    auth: "identity-session",
    pathParameter: {
      name: "orderId",
      schema: "OrderId",
      example: paymentsV1Examples.DirectRefund.orderId,
    },
    headerParameters: [
      {
        name: "Idempotency-Key",
        schema: "IdempotencyKey",
        example: "refund-request-135",
        required: true,
      },
    ],
    request: {
      schema: "RequestDirectRefundInput",
      example: paymentsV1Examples.RequestDirectRefundInput,
    },
    responses: [
      { status: 200, schema: "DirectRefund" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "DirectRefundError" },
      { status: 404, schema: "DirectRefundError" },
      { status: 409, schema: "DirectRefundError" },
      { status: 422, schema: "DirectRefundError" },
      { status: 428, schema: "DirectRefundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...paymentsV1Operations.readDirectRefund,
    tag: "payments",
    auth: "identity-session",
    pathParameter: {
      name: "orderId",
      schema: "OrderId",
      example: paymentsV1Examples.DirectRefund.orderId,
    },
    responses: [
      { status: 200, schema: "DirectRefund" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "DirectRefundError" },
      { status: 404, schema: "DirectRefundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...paymentsV1Operations.recordDirectRefundResult,
    tag: "payments",
    auth: "none",
    pathParameter: {
      name: "provider",
      schema: "PaymentProviderKey",
      example: "DEV",
    },
    headerParameters: [
      {
        name: "Idempotency-Key",
        schema: "IdempotencyKey",
        example: "refund-result-135",
        required: true,
      },
    ],
    request: {
      schema: "ProviderRefundCallbackInput",
      example: paymentsV1Examples.ProviderRefundCallbackInput,
    },
    responses: [
      { status: 200, schema: "DirectRefund" },
      { status: 404, schema: "DirectRefundError" },
      { status: 409, schema: "DirectRefundError" },
      { status: 422, schema: "DirectRefundError" },
      { status: 428, schema: "DirectRefundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

export const contribute_payments_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    { ...createPaymentsV1JsonSchemas(), ...createPaymentsV2JsonSchemas() },
    { ...paymentsV1Examples, ...paymentsV2Examples },
    operations,
    {
      descriptions: {
        200: "Payment state returned",
        201: "Payment attempt dispatched",
        202: "Provider reconciliation requested",
        401: "Identity session is missing or invalid",
        403: "Required seller or platform permission is missing",
        404: "Payment attempt or direct refund is unavailable",
        409: "The idempotency key conflicts with an existing request",
        422: "The payment or refund transition is invalid",
        428: "Idempotency precondition is missing",
        500: "Unexpected server error",
      },
    },
  );
