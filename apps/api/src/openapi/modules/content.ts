import { contentV1Examples } from "@sevo/contracts/content/v1";
import {
  contentV2Examples,
  contentV2Operations,
  createContentV2JsonSchemas,
} from "@sevo/contracts/content/v2";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const idempotencyHeader = {
  name: "Idempotency-Key",
  schema: "ContentIdempotencyKey",
  example: contentV1Examples.ContentIdempotencyKey,
  required: true,
} as const;

const authenticatedPublishing = {
  tag: "content",
  auth: "identity-session",
  headerParameters: [idempotencyHeader],
} as const;

const publishingErrorResponses = [
  { status: 401, schema: "UnauthorizedError" },
  { status: 403, schema: "ContentError" },
  { status: 409, schema: "ContentError" },
  { status: 422, schema: "ContentError" },
  { status: 428, schema: "ContentError" },
  { status: 500, schema: "InternalServerError" },
] as const;

const v2Operations = [
  {
    ...contentV2Operations.publishSalesContent,
    ...authenticatedPublishing,
    request: {
      schema: "PublishSalesContentInputV2",
      example: contentV2Examples.PublishSalesContentInputV2,
    },
    responses: [{ status: 201, schema: "SalesContent" }, ...publishingErrorResponses],
  },
  {
    ...contentV2Operations.publishPurchaseExperience,
    ...authenticatedPublishing,
    request: {
      schema: "PublishPurchaseExperienceInputV2",
      example: contentV2Examples.PublishPurchaseExperienceInputV2,
    },
    responses: [
      { status: 201, schema: "PurchaseExperience" },
      ...publishingErrorResponses,
    ],
  },
  {
    ...contentV2Operations.readPurchaseExperienceEligibility,
    tag: "content",
    auth: "identity-session",
    pathParameter: {
      name: "orderItemId",
      schema: "OrderItemId",
      example: contentV1Examples.OrderItemId,
    },
    responses: [
      { status: 200, schema: "PurchaseExperienceEligibilityDecisionV2" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 422, schema: "ContentError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...contentV2Operations.readProductPurchaseExperiences,
    tag: "content",
    auth: "none",
    pathParameter: {
      name: "productId",
      schema: "ProductId",
      example: contentV2Examples.ProductPurchaseExperiences.productId,
    },
    responses: [
      { status: 200, schema: "ProductPurchaseExperiences" },
      { status: 422, schema: "ContentError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...contentV2Operations.createPurchaseExperienceMediaContext,
    ...authenticatedPublishing,
    request: {
      schema: "CreatePurchaseExperienceMediaContextInput",
      example: contentV2Examples.CreatePurchaseExperienceMediaContextInput,
    },
    responses: [
      { status: 201, schema: "PurchaseExperienceMediaContext" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 409, schema: "ContentError" },
      { status: 422, schema: "ContentError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...contentV2Operations.readPublicSalesContent,
    tag: "content",
    auth: "none",
    queryParameters: [
      {
        name: "storeIds",
        schema: "PublicSalesContentStoreIdsV2",
        example: contentV2Examples.PublicSalesContentStoreIdsV2,
        required: true,
      },
    ],
    responses: [
      { status: 200, schema: "PublicSalesContentFeedV2" },
      { status: 422, schema: "ContentErrorV2" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

const responseMetadata = {
  descriptions: {
    200: "Content read",
    201: "Content published",
    401: "Identity session is missing or invalid",
    403: "This identity cannot publish for the requested context",
    409: "The idempotency key or submission conflicts with existing content",
    422: "The linked product or purchase is not eligible",
    428: "Idempotency precondition is missing",
    500: "Unexpected server error",
  },
} as const;

export const contribute_content_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    createContentV2JsonSchemas(),
    { ...contentV1Examples, ...contentV2Examples },
    v2Operations,
    responseMetadata,
  );
