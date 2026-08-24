import { createOrdersV1JsonSchemas, ordersV1Examples } from "@sevo/contracts/orders/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const idempotencyHeader = [
  {
    name: "Idempotency-Key",
    schema: "CartIdempotencyKey",
    example: ordersV1Examples.CartIdempotencyKey,
    required: true,
  },
] as const;

const operations = [
  {
    operationId: "readCart",
    method: "get",
    path: "/v1/cart",
    tag: "orders",
    auth: "none",
    responses: [
      { status: 200, schema: "CartReadResult" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "upsertCartItem",
    method: "put",
    path: "/v1/cart/items/{variantId}",
    tag: "orders",
    auth: "none",
    pathParameter: {
      name: "variantId",
      schema: "CartVariantId",
      example: ordersV1Examples.CartVariantId,
    },
    headerParameters: idempotencyHeader,
    request: {
      schema: "CartMutationInput",
      example: ordersV1Examples.CartMutationInput,
    },
    responses: [
      { status: 200, schema: "Cart" },
      { status: 409, schema: "CartError" },
      { status: 422, schema: "CartError" },
      { status: 428, schema: "CartError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "replaceCartStore",
    method: "post",
    path: "/v1/cart/store-replacement",
    tag: "orders",
    auth: "none",
    headerParameters: idempotencyHeader,
    request: {
      schema: "ReplaceCartStoreInput",
      example: ordersV1Examples.ReplaceCartStoreInput,
    },
    responses: [
      { status: 200, schema: "Cart" },
      { status: 409, schema: "CartError" },
      { status: 422, schema: "CartError" },
      { status: 428, schema: "CartError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "attachGuestCart",
    method: "post",
    path: "/v1/cart/attach",
    tag: "orders",
    auth: "identity-session",
    headerParameters: idempotencyHeader,
    responses: [
      { status: 200, schema: "CartResolution" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 409, schema: "CartResolution" },
      { status: 428, schema: "CartError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "resolveCartConflict",
    method: "post",
    path: "/v1/cart/resolve",
    tag: "orders",
    auth: "identity-session",
    headerParameters: idempotencyHeader,
    request: {
      schema: "AttachCartInput",
      example: ordersV1Examples.AttachCartInput,
    },
    responses: [
      { status: 200, schema: "CartResolution" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 409, schema: "CartError" },
      { status: 422, schema: "CartError" },
      { status: 428, schema: "CartError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

export const contribute_orders_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    createOrdersV1JsonSchemas(),
    ordersV1Examples,
    operations,
    {
      descriptions: {
        200: "Cart state returned",
        401: "Identity session is missing or invalid",
        409: "Cart state requires a fresh revision or explicit resolution",
        422: "Cart input is invalid or unavailable",
        428: "Idempotency precondition is missing",
        500: "Unexpected server error",
      },
    },
  );
