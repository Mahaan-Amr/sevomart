import {
  createPaymentsV1JsonSchemas,
  paymentsV1Examples,
} from "@sevo/contracts/payments/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const operations = [
  {
    operationId: "createDirectPaymentAttempt",
    method: "post",
    path: "/v1/orders/{orderId}/payment-attempts",
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
      { status: 409, schema: "InternalServerError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readDirectPaymentAttempt",
    method: "get",
    path: "/v1/payment-attempts/{attemptId}",
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
      { status: 404, schema: "InternalServerError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "acceptDevPaymentCallback",
    method: "post",
    path: "/internal/v1/payment-providers/{provider}/callbacks",
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
      { status: 422, schema: "InternalServerError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "listPlatformPaymentReviews",
    method: "get",
    path: "/v1/platform/payment-reviews",
    tag: "payments",
    auth: "platform-agent-session",
    responses: [
      { status: 200, schema: "PaymentReviewQueue" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "InternalServerError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

export const contribute_payments_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    createPaymentsV1JsonSchemas(),
    paymentsV1Examples,
    operations,
    {
      descriptions: {
        200: "Payment state returned",
        201: "Payment attempt dispatched",
        401: "Identity session is missing or invalid",
        403: "Required platform permission is missing",
        404: "Payment attempt is unavailable to this identity",
        409: "Order is not payable",
        422: "Provider callback is invalid",
        500: "Unexpected server error",
      },
    },
  );
