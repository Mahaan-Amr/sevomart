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
    operationId: "getDiscoveryFeed",
    method: "get",
    path: "/v1/feeds/discovery",
    tag: "discovery",
    auth: "none",
    queryParameters: [
      {
        name: "cursor",
        schema: "DiscoveryFeedCursor",
        example: discoveryV1Examples.DiscoveryFeedCursor,
        required: false,
      },
      {
        name: "limit",
        schema: "DiscoveryFeedLimit",
        example: discoveryV1Examples.DiscoveryFeedLimit,
        required: false,
      },
    ],
    responses: [
      {
        status: 200,
        schema: "DiscoveryFeedPageV1",
        headers: {
          "X-Projection-Lag-Ms": {
            description: "Age of the latest committed discovery projection",
            schema: { type: "string" },
          },
        },
      },
      { status: 400, schema: "DiscoveryFeedErrorV1" },
      { status: 409, schema: "DiscoveryFeedErrorV1" },
      { status: 410, schema: "DiscoveryFeedErrorV1" },
      {
        status: 503,
        schema: "DiscoveryFeedErrorV1",
        headers: {
          "Retry-After": {
            description: "Seconds before retrying an unavailable projection",
            schema: { type: "string" },
          },
        },
      },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "getFollowingFeed",
    method: "get",
    path: "/v1/me/feeds/following",
    tag: "discovery",
    auth: "identity-session",
    queryParameters: [
      {
        name: "cursor",
        schema: "DiscoveryFeedCursor",
        example: discoveryV1Examples.DiscoveryFeedCursor,
        required: false,
      },
      {
        name: "limit",
        schema: "DiscoveryFeedLimit",
        example: discoveryV1Examples.DiscoveryFeedLimit,
        required: false,
      },
    ],
    responses: [
      {
        status: 200,
        schema: "FollowingFeedPageV1",
        headers: {
          "X-Projection-Lag-Ms": {
            description: "Age of the latest committed discovery projection",
            schema: { type: "string" },
          },
        },
      },
      { status: 400, schema: "DiscoveryFeedErrorV1" },
      { status: 401, schema: "DiscoveryFeedErrorV1" },
      { status: 403, schema: "DiscoveryFeedErrorV1" },
      { status: 409, schema: "DiscoveryFeedErrorV1" },
      { status: 410, schema: "DiscoveryFeedErrorV1" },
      {
        status: 503,
        schema: "DiscoveryFeedErrorV1",
        headers: {
          "Retry-After": {
            description: "Seconds before retrying an unavailable projection",
            schema: { type: "string" },
          },
        },
      },
      { status: 500, schema: "InternalServerError" },
    ],
  },
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
    200: "Discovery response returned",
    400: "Discovery cursor is invalid",
    401: "Identity session is missing or invalid",
    403: "Identity is inactive",
    404: "Published store was not found",
    409: "Revision or idempotency key conflicts with current state",
    410: "Discovery cursor has expired",
    422: "The acting identity owns this store",
    428: "Required write precondition is missing or malformed",
    500: "Unexpected server error",
    503: "Discovery projection is unavailable",
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
