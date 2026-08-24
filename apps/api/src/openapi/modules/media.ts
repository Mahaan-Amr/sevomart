import {
  createMediaV1JsonSchemas,
  MEDIA_UPLOAD_ACCEPTED_TYPES,
  MEDIA_UPLOAD_MAX_BYTES,
  MEDIA_UPLOAD_MAX_PIXELS,
  mediaV1Examples,
} from "@sevo/contracts/media/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const operations = [
  {
    operationId: "uploadStoreMedia",
    method: "post",
    path: "/v1/seller/media",
    tag: "media",
    auth: "identity-session",
    request: {
      schema: "MediaUploadInput",
      example: mediaV1Examples.MediaUploadInput,
      contentType: "multipart/form-data",
    },
    responses: [
      { status: 201, schema: "MediaReference" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 413, schema: "ValidationError" },
      { status: 422, schema: "ValidationError" },
      { status: 429, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "createProductImageUpload",
    method: "post",
    path: "/v1/seller/products/{productId}/images",
    tag: "media",
    auth: "identity-session",
    pathParameter: {
      name: "productId",
      schema: "ProductId",
      example: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
    },
    request: {
      schema: "MediaUploadInput",
      example: mediaV1Examples.MediaUploadInput,
      contentType: "multipart/form-data",
    },
    responses: [
      { status: 201, schema: "MediaReference" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "MediaNotFoundError" },
      { status: 413, schema: "ValidationError" },
      { status: 422, schema: "ValidationError" },
      { status: 429, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readMedia",
    method: "get",
    path: "/v1/media/{mediaId}",
    tag: "media",
    auth: "none",
    pathParameter: {
      name: "mediaId",
      schema: "MediaId",
      example: mediaV1Examples.MediaId,
    },
    responses: [
      { status: 200, binaryMedia: true },
      { status: 404, schema: "MediaNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

const responseMetadata = {
  descriptions: {
    200: "Successful response",
    201: "Resource created",
    401: "Identity session is missing or invalid",
    404: "Media or product was not found",
    413: "Uploaded file exceeds the accepted limit",
    422: "Request validation failed",
    429: "Seller upload rate limit exceeded",
    500: "Unexpected server error",
  },
};

export const contribute_media_openApi: OpenApiContributor = (document) => {
  const composed = addModuleOpenApiContract(
    document,
    createMediaV1JsonSchemas(),
    mediaV1Examples,
    operations,
    responseMetadata,
  );
  const mediaUploadSchema = composed.components?.schemas?.MediaUploadInput as {
    properties?: Record<string, Record<string, unknown>>;
  };
  if (mediaUploadSchema.properties?.file) {
    mediaUploadSchema.properties.file = {
      type: "string",
      format: "binary",
      description:
        "JPEG, PNG, or WebP; maximum 10 MB and 24 megapixels; animated images are rejected.",
      "x-maxBytes": MEDIA_UPLOAD_MAX_BYTES,
      "x-maxPixels": MEDIA_UPLOAD_MAX_PIXELS,
      "x-acceptedMediaTypes": [...MEDIA_UPLOAD_ACCEPTED_TYPES],
    };
  }
  return composed;
};
