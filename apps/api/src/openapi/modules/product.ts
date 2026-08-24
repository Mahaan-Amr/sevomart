import {
  createProductV1JsonSchemas,
  productV1Examples,
} from "@sevo/contracts/product/v1";
import { storeV1Examples } from "@sevo/contracts/store/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const productIdParameter = {
  name: "productId",
  schema: "ProductId",
  example: productV1Examples.ProductId,
};

const operations = [
  {
    operationId: "createSellerProduct",
    method: "post",
    path: "/v1/seller/products",
    tag: "product",
    auth: "identity-session",
    request: {
      schema: "CreateSimpleProductInput",
      example: productV1Examples.CreateSimpleProductInput,
    },
    responses: [
      { status: 201, schema: "SimpleProductView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 409, schema: "ProductWriteConflictError" },
      { status: 428, schema: "ProductPreconditionRequiredError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "replaceProductWorkingCopy",
    method: "put",
    path: "/v1/seller/products/{productId}/working-copy",
    tag: "product",
    auth: "identity-session",
    pathParameter: productIdParameter,
    request: {
      schema: "ReplaceSimpleProductWorkingCopy",
      example: productV1Examples.ReplaceSimpleProductWorkingCopy,
    },
    responses: [
      { status: 200, schema: "SimpleProductView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "ProductNotFoundError" },
      { status: 409, schema: "ProductWriteConflictError" },
      { status: 422, schema: "ValidationError" },
      { status: 428, schema: "ProductPreconditionRequiredError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "previewSellerProduct",
    method: "get",
    path: "/v1/seller/products/{productId}/preview",
    tag: "product",
    auth: "identity-session",
    pathParameter: productIdParameter,
    responses: [
      { status: 200, schema: "SimpleProductPreview" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "ProductNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "publishSellerProduct",
    method: "post",
    path: "/v1/seller/products/{productId}/publications",
    tag: "product",
    auth: "identity-session",
    pathParameter: productIdParameter,
    request: {
      schema: "PublishSimpleProductInput",
      example: productV1Examples.PublishSimpleProductInput,
    },
    responses: [
      { status: 200, schema: "PublicSimpleProduct" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "ProductNotFoundError" },
      { status: 409, schema: "ProductWriteConflictError" },
      { status: 422, schema: "ValidationError" },
      { status: 428, schema: "ProductPreconditionRequiredError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "listPublishedStoreProducts",
    method: "get",
    path: "/v1/stores/{storeSlug}/products",
    tag: "product",
    auth: "none",
    pathParameter: {
      name: "storeSlug",
      schema: "StoreSlug",
      example: storeV1Examples.StoreSlug,
    },
    responses: [
      { status: 200, schema: "PublicSimpleProductList" },
      { status: 404, schema: "ProductNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "getPublishedStoreProduct",
    method: "get",
    path: "/v1/stores/{storeSlug}/products/{productId}",
    tag: "product",
    auth: "none",
    pathParameter: productIdParameter,
    responses: [
      { status: 200, schema: "PublicSimpleProduct" },
      { status: 404, schema: "ProductNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

const idempotencyHeader = {
  name: "Idempotency-Key",
  in: "header",
  schema: { $ref: "#/components/schemas/ProductIdempotencyKey" },
  example: productV1Examples.ProductIdempotencyKey,
  required: true,
} as const;

const revisionHeader = {
  name: "If-Match",
  in: "header",
  schema: { $ref: "#/components/schemas/ProductRevisionTag" },
  example: productV1Examples.ProductRevisionTag,
  required: true,
} as const;

export const contribute_product_openApi: OpenApiContributor = (document) => {
  const composed = addModuleOpenApiContract(
    document,
    createProductV1JsonSchemas(),
    productV1Examples,
    operations,
    {
      descriptions: {
        200: "Successful response",
        201: "Product draft created",
        401: "Identity session is missing or invalid",
        404: "Product was not found",
        409: "Product write conflicts with current state",
        422: "Product is not ready or input is invalid",
        428: "Required write precondition is missing or malformed",
        500: "Unexpected server error",
      },
    },
  );
  const createOperation = composed.paths["/v1/seller/products"]?.post as
    { parameters?: unknown[] } | undefined;
  if (!createOperation) throw new Error("POST /v1/seller/products is missing");
  createOperation.parameters = [
    ...(createOperation.parameters ?? []),
    idempotencyHeader,
  ];
  for (const [method, path] of [
    ["put", "/v1/seller/products/{productId}/working-copy"],
    ["post", "/v1/seller/products/{productId}/publications"],
  ] as const) {
    const operation = composed.paths[path]?.[method] as
      { parameters?: unknown[] } | undefined;
    if (!operation) throw new Error(`${method.toUpperCase()} ${path} is missing`);
    operation.parameters = [
      ...(operation.parameters ?? []),
      idempotencyHeader,
      revisionHeader,
    ];
  }
  const publicDetail = composed.paths["/v1/stores/{storeSlug}/products/{productId}"]
    ?.get as { parameters?: unknown[] } | undefined;
  publicDetail?.parameters?.push({
    name: "storeSlug",
    in: "path",
    required: true,
    schema: { $ref: "#/components/schemas/StoreSlug" },
    example: storeV1Examples.StoreSlug,
  });
  return composed;
};
