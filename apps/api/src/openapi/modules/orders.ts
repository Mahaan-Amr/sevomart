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

const guestCartWriteHeaders = [
  ...idempotencyHeader,
  {
    name: "X-Sevo-Guest-Scope",
    schema: "CartGuestScope",
    example: ordersV1Examples.CartGuestScope,
    required: false,
  },
] as const;

const noStoreHeader = {
  "Cache-Control": {
    description: "Sensitive buyer data must not be cached",
    schema: { type: "string" as const },
  },
};

const idempotencyRetryHeader = {
  "Retry-After": {
    description: "Seconds before retrying an in-progress idempotent request",
    schema: { type: "string" as const, example: "1" },
  },
};

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
    headerParameters: guestCartWriteHeaders,
    request: {
      schema: "CartMutationInput",
      example: ordersV1Examples.CartMutationInput,
    },
    responses: [
      { status: 200, schema: "Cart" },
      { status: 409, schema: "CartError", headers: idempotencyRetryHeader },
      { status: 422, schema: "CartError" },
      { status: 428, schema: "CartError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "removeCartItem",
    method: "delete",
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
      schema: "CartItemRemovalInput",
      example: ordersV1Examples.CartItemRemovalInput,
    },
    responses: [
      { status: 200, schema: "Cart" },
      { status: 409, schema: "CartError", headers: idempotencyRetryHeader },
      { status: 422, schema: "CartError" },
      { status: 428, schema: "CartError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "confirmCartReview",
    method: "post",
    path: "/v1/cart/review",
    tag: "orders",
    auth: "none",
    headerParameters: idempotencyHeader,
    request: {
      schema: "CartReviewInput",
      example: ordersV1Examples.CartReviewInput,
    },
    responses: [
      { status: 200, schema: "Cart" },
      { status: 409, schema: "CartError", headers: idempotencyRetryHeader },
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
      { status: 409, schema: "CartError", headers: idempotencyRetryHeader },
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
      {
        status: 409,
        schema: "CartAttachConflict",
        headers: idempotencyRetryHeader,
      },
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
      { status: 409, schema: "CartError", headers: idempotencyRetryHeader },
      { status: 422, schema: "CartError" },
      { status: 428, schema: "CartError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readCheckoutOptions",
    method: "get",
    path: "/v1/checkout/options",
    tag: "orders",
    auth: "identity-session",
    responses: [
      { status: 200, schema: "CheckoutOptions", headers: noStoreHeader },
      { status: 401, schema: "UnauthorizedError" },
      { status: 409, schema: "CheckoutRevisionConflict" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "prepareCheckout",
    method: "post",
    path: "/v1/checkout/prepare",
    tag: "orders",
    auth: "identity-session",
    request: {
      schema: "PrepareCheckoutInput",
      example: ordersV1Examples.PrepareCheckoutInput,
    },
    responses: [
      { status: 200, schema: "CheckoutPreparation", headers: noStoreHeader },
      { status: 401, schema: "UnauthorizedError" },
      { status: 409, schema: "CheckoutRevisionConflict" },
      { status: 422, schema: "CheckoutRevisionConflict" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "createOrder",
    method: "post",
    path: "/v1/orders",
    tag: "orders",
    auth: "identity-session",
    headerParameters: idempotencyHeader,
    request: {
      schema: "CreateOrderInput",
      example: ordersV1Examples.CreateOrderInput,
    },
    responses: [
      { status: 201, schema: "Order", headers: noStoreHeader },
      { status: 401, schema: "UnauthorizedError" },
      {
        status: 409,
        schema: "CheckoutRevisionConflict",
        headers: idempotencyRetryHeader,
      },
      { status: 422, schema: "CheckoutRevisionConflict" },
      { status: 428, schema: "CheckoutRevisionConflict" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "listSavedAddresses",
    method: "get",
    path: "/v1/addresses",
    tag: "orders",
    auth: "identity-session",
    responses: [
      { status: 200, schema: "SavedAddressList", headers: noStoreHeader },
      { status: 401, schema: "UnauthorizedError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "createSavedAddress",
    method: "post",
    path: "/v1/addresses",
    tag: "orders",
    auth: "identity-session",
    headerParameters: idempotencyHeader,
    request: {
      schema: "CreateSavedAddressInput",
      example: ordersV1Examples.CreateSavedAddressInput,
    },
    responses: [
      { status: 201, schema: "SavedAddress", headers: noStoreHeader },
      { status: 401, schema: "UnauthorizedError" },
      { status: 409, schema: "SavedAddressError", headers: idempotencyRetryHeader },
      { status: 422, schema: "SavedAddressError" },
      { status: 428, schema: "SavedAddressError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "updateSavedAddress",
    method: "put",
    path: "/v1/addresses/{addressId}",
    tag: "orders",
    auth: "identity-session",
    pathParameter: {
      name: "addressId",
      schema: "SavedAddressId",
      example: ordersV1Examples.SavedAddressId,
    },
    headerParameters: idempotencyHeader,
    request: {
      schema: "UpdateSavedAddressInput",
      example: ordersV1Examples.UpdateSavedAddressInput,
    },
    responses: [
      { status: 200, schema: "SavedAddress", headers: noStoreHeader },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "SavedAddressError" },
      { status: 409, schema: "SavedAddressError", headers: idempotencyRetryHeader },
      { status: 422, schema: "SavedAddressError" },
      { status: 428, schema: "SavedAddressError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "deleteSavedAddress",
    method: "delete",
    path: "/v1/addresses/{addressId}",
    tag: "orders",
    auth: "identity-session",
    pathParameter: {
      name: "addressId",
      schema: "SavedAddressId",
      example: ordersV1Examples.SavedAddressId,
    },
    headerParameters: idempotencyHeader,
    request: {
      schema: "DeleteSavedAddressInput",
      example: ordersV1Examples.DeleteSavedAddressInput,
    },
    responses: [
      { status: 204, noContent: true, headers: noStoreHeader },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "SavedAddressError" },
      { status: 409, schema: "SavedAddressError", headers: idempotencyRetryHeader },
      { status: 422, schema: "SavedAddressError" },
      { status: 428, schema: "SavedAddressError" },
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
        201: "Saved address created",
        204: "Saved address removed from future selection",
        401: "Identity session is missing or invalid",
        404: "Saved address is unavailable to this identity",
        409: "Cart state requires a fresh revision or explicit resolution",
        422: "Cart input is invalid or unavailable",
        428: "Idempotency precondition is missing",
        500: "Unexpected server error",
      },
    },
  );
