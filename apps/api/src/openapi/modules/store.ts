import { createStoreV1JsonSchemas, storeV1Examples } from "@sevo/contracts/store/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const storeWriteHeaders = [
  {
    name: "Idempotency-Key",
    in: "header",
    schema: { $ref: "#/components/schemas/StoreIdempotencyKey" },
    example: storeV1Examples.StoreIdempotencyKey,
    required: true,
  },
  {
    name: "If-Match",
    in: "header",
    schema: { $ref: "#/components/schemas/StoreRevisionTag" },
    example: storeV1Examples.StoreRevisionTag,
    required: true,
  },
] as const;

const operations = [
  {
    operationId: "readStoreDraft",
    method: "get",
    path: "/v1/seller/store/draft",
    tag: "store",
    auth: "identity-session",
    responses: [
      { status: 200, schema: "StoreDraft" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "StoreNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "saveStoreDraft",
    method: "put",
    path: "/v1/seller/store/draft",
    tag: "store",
    auth: "identity-session",
    request: {
      schema: "StoreDraftInput",
      example: storeV1Examples.StoreDraftInput,
    },
    responses: [
      { status: 200, schema: "StoreDraft" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 409, schema: "StoreWriteConflictError" },
      { status: 422, schema: "ValidationError" },
      { status: 428, schema: "StorePreconditionRequiredError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "checkStoreSlugAvailability",
    method: "get",
    path: "/v1/store-slugs/{slug}/availability",
    tag: "store",
    auth: "identity-session",
    pathParameter: {
      name: "slug",
      schema: "StoreSlug",
      example: storeV1Examples.StoreSlug,
    },
    responses: [
      { status: 200, schema: "SlugAvailability" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "previewStore",
    method: "get",
    path: "/v1/seller/store/preview",
    tag: "store",
    auth: "identity-session",
    responses: [
      { status: 200, schema: "StorePreview" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "StoreNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "publishStore",
    method: "post",
    path: "/v1/seller/store/publication",
    tag: "store",
    auth: "identity-session",
    responses: [
      { status: 200, schema: "StorePublication" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "StoreNotFoundError" },
      { status: 409, schema: "StoreWriteConflictError" },
      { status: 422, schema: "ValidationError" },
      { status: 428, schema: "StorePreconditionRequiredError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readPublishedStore",
    method: "get",
    path: "/v1/stores/{slug}",
    tag: "store",
    auth: "none",
    pathParameter: {
      name: "slug",
      schema: "StoreSlug",
      example: storeV1Examples.StoreSlug,
    },
    responses: [
      { status: 200, schema: "PublicStore" },
      { status: 404, schema: "StoreNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

const responseMetadata = {
  descriptions: {
    200: "Successful response",
    401: "Identity session is missing or invalid",
    404: "Store was not found",
    409: "Store slug conflicts with an existing store",
    422: "Request validation failed",
    428: "Required write precondition is missing or malformed",
    500: "Unexpected server error",
  },
  headersBySchema: {
    StoreDraft: {
      ETag: {
        description: "Opaque optimistic-concurrency tag for the Store revision",
        schema: { type: "string" as const },
      },
    },
    StorePublication: {
      ETag: {
        description: "Opaque optimistic-concurrency tag for the Store revision",
        schema: { type: "string" as const },
      },
    },
  },
};

export const contribute_store_openApi: OpenApiContributor = (document) => {
  const composed = addModuleOpenApiContract(
    document,
    createStoreV1JsonSchemas(),
    storeV1Examples,
    operations,
    responseMetadata,
  );
  for (const [method, path] of [
    ["put", "/v1/seller/store/draft"],
    ["post", "/v1/seller/store/publication"],
  ] as const) {
    const operation = composed.paths[path]?.[method] as
      { parameters?: unknown[] } | undefined;
    if (!operation) throw new Error(`${method.toUpperCase()} ${path} is missing`);
    operation.parameters = [...(operation.parameters ?? []), ...storeWriteHeaders];
  }
  return composed;
};
