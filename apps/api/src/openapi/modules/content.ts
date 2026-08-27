import {
  contentV1Examples,
  contentV1Operations,
  createContentV1JsonSchemas,
} from "@sevo/contracts/content/v1";

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

const operations = [
  {
    ...contentV1Operations.publishSalesContent,
    ...authenticatedPublishing,
    request: {
      schema: "PublishSalesContentInput",
      example: contentV1Examples.PublishSalesContentInput,
    },
    responses: [{ status: 201, schema: "SalesContent" }, ...publishingErrorResponses],
  },
  {
    ...contentV1Operations.publishPurchaseExperience,
    ...authenticatedPublishing,
    request: {
      schema: "PublishPurchaseExperienceInput",
      example: contentV1Examples.PublishPurchaseExperienceInput,
    },
    responses: [
      { status: 201, schema: "PurchaseExperience" },
      ...publishingErrorResponses,
    ],
  },
] as const satisfies readonly ApiOperationContract[];

export const contribute_content_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    createContentV1JsonSchemas(),
    contentV1Examples,
    operations,
    {
      descriptions: {
        201: "Content published",
        401: "Identity session is missing or invalid",
        403: "This identity cannot publish for the requested context",
        409: "The idempotency key or submission conflicts with existing content",
        422: "The linked product or purchase is not eligible",
        428: "Idempotency precondition is missing",
        500: "Unexpected server error",
      },
    },
  );
