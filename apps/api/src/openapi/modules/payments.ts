import {
  createPaymentsV1JsonSchemas,
  paymentsV1Examples,
  paymentsV1Operations,
} from "@sevo/contracts/payments/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const operations = [
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
    ...paymentsV1Operations.listPlatformPaymentReviews,
    tag: "payments",
    auth: "platform-agent-session",
    responses: [
      { status: 200, schema: "PaymentReviewQueue" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "PaymentReviewError" },
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
        428: "Idempotency precondition is missing",
        500: "Unexpected server error",
      },
    },
  );
