import {
  createDiscoveryV1JsonSchemas,
  discoveryV1Examples,
} from "@sevo/contracts/discovery/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const writeHeaders = [
  {
    name: "Idempotency-Key",
    schema: "DiscoveryFollowIdempotencyKey",
    example: discoveryV1Examples.DiscoveryFollowIdempotencyKey,
    required: true,
  },
  {
    name: "If-Match",
    schema: "DiscoveryFollowRevisionTag",
    example: discoveryV1Examples.DiscoveryFollowRevisionTag,
    required: false,
  },
] as const;

const operations = [
  {
    operationId: "activateStoreFollow",
    method: "put",
    path: "/v1/me/follows/{storeId}",
    tag: "discovery",
    auth: "identity-session",
    pathParameter: {
      name: "storeId",
      schema: "DiscoveryStoreId",
      example: discoveryV1Examples.DiscoveryStoreId,
    },
    headerParameters: writeHeaders,
    responses: [
      { status: 200, schema: "StoreFollowViewV1" },
      { status: 401, schema: "DiscoveryFollowErrorV1" },
      { status: 404, schema: "DiscoveryFollowErrorV1" },
      { status: 409, schema: "DiscoveryFollowErrorV1" },
      { status: 422, schema: "DiscoveryFollowErrorV1" },
      { status: 428, schema: "DiscoveryFollowErrorV1" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "deactivateStoreFollow",
    method: "delete",
    path: "/v1/me/follows/{storeId}",
    tag: "discovery",
    auth: "identity-session",
    pathParameter: {
      name: "storeId",
      schema: "DiscoveryStoreId",
      example: discoveryV1Examples.DiscoveryStoreId,
    },
    headerParameters: writeHeaders,
    responses: [
      { status: 200, schema: "StoreFollowViewV1" },
      { status: 401, schema: "DiscoveryFollowErrorV1" },
      { status: 404, schema: "DiscoveryFollowErrorV1" },
      { status: 409, schema: "DiscoveryFollowErrorV1" },
      { status: 428, schema: "DiscoveryFollowErrorV1" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

const responseMetadata = {
  descriptions: {
    200: "Store-follow relationship returned",
    401: "Identity session is missing or invalid",
    404: "Published store was not found",
    409: "Revision or idempotency key conflicts with current state",
    422: "The acting identity owns this store",
    428: "Required write precondition is missing or malformed",
    500: "Unexpected server error",
  },
  headersBySchema: {
    StoreFollowViewV1: {
      ETag: {
        description: "Opaque optimistic-concurrency tag for this relationship",
        schema: { type: "string" as const },
      },
    },
  },
};

export const contribute_discovery_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    createDiscoveryV1JsonSchemas(),
    discoveryV1Examples,
    operations,
    responseMetadata,
  );
