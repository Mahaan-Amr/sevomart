import {
  createFulfillmentV1JsonSchemas,
  fulfillmentV1Examples,
  fulfillmentV1Operations,
} from "@sevo/contracts/fulfillment/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const orderPath = {
  name: "orderId",
  schema: "OrderId",
  example: fulfillmentV1Examples.FulfillmentTimeline.orderId,
} as const;

const readErrors = [
  { status: 401, schema: "UnauthorizedError" },
  { status: 403, schema: "FulfillmentError" },
  { status: 404, schema: "FulfillmentError" },
  { status: 500, schema: "InternalServerError" },
] as const;

const operations = [
  {
    ...fulfillmentV1Operations.advanceFulfillment,
    tag: "fulfillment",
    auth: "identity-session",
    pathParameter: orderPath,
    headerParameters: [
      {
        name: "Idempotency-Key",
        schema: "FulfillmentIdempotencyKey",
        example: fulfillmentV1Examples.FulfillmentIdempotencyKey,
        required: true,
      },
    ],
    request: {
      schema: "AdvanceFulfillmentInput",
      example: fulfillmentV1Examples.AdvanceFulfillmentInput,
    },
    responses: [
      { status: 200, schema: "FulfillmentTimeline" },
      ...readErrors,
      { status: 409, schema: "FulfillmentError" },
      { status: 422, schema: "FulfillmentError" },
      { status: 428, schema: "FulfillmentError" },
    ],
  },
  ...[
    fulfillmentV1Operations.readSellerFulfillment,
    fulfillmentV1Operations.readBuyerFulfillment,
  ].map((operation) => ({
    ...operation,
    tag: "fulfillment" as const,
    auth: "identity-session" as const,
    pathParameter: orderPath,
    responses: [{ status: 200, schema: "FulfillmentTimeline" }, ...readErrors],
  })),
] as const satisfies readonly ApiOperationContract[];

export const contribute_fulfillment_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    createFulfillmentV1JsonSchemas(),
    fulfillmentV1Examples,
    operations,
    {
      descriptions: {
        200: "The current fulfillment state and shared audit timeline",
        401: "Identity session is missing or invalid",
        403: "The seller cannot fulfill this order",
        404: "The order fulfillment is unavailable in this identity context",
        409: "The idempotency key conflicts with an earlier request",
        422: "The requested transition or shipment data is invalid",
        428: "Idempotency precondition is missing",
        500: "Unexpected server error",
      },
    },
  );
