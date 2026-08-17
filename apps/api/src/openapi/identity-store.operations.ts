import { identityAccessV1Paths } from "@sevo/contracts/identity-access/v1";

export type IdentityStoreSchemaName =
  | "OtpRequest"
  | "OtpChallenge"
  | "OtpVerification"
  | "SellerSession"
  | "UnauthorizedError"
  | "StoreSlug"
  | "StoreDraftInput"
  | "StoreDraft"
  | "SlugAvailability"
  | "StorePreview"
  | "PublicStore"
  | "StorePublication"
  | "SlugConflictError"
  | "StoreNotFoundError"
  | "MediaId"
  | "MediaUploadInput"
  | "MediaReference"
  | "MediaNotFoundError"
  | "ValidationError"
  | "InternalServerError";

export type ApiResponseContract =
  | { status: number; schema: IdentityStoreSchemaName }
  | { status: number; binaryMedia: true };

type ApiOperationContract = {
  operationId: string;
  method: "get" | "post" | "put";
  path: string;
  auth: "none" | "seller-session";
  pathParameter?: "slug" | "mediaId";
  request?: IdentityStoreSchemaName;
  responses: readonly ApiResponseContract[];
};

export const identityStoreApiOperations = [
  {
    operationId: "requestSellerOtp",
    method: "post",
    path: identityAccessV1Paths.requestOtp,
    auth: "none",
    request: "OtpRequest",
    responses: [
      { status: 202, schema: "OtpChallenge" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "verifySellerOtp",
    method: "post",
    path: identityAccessV1Paths.verifyOtp,
    auth: "none",
    request: "OtpVerification",
    responses: [
      { status: 200, schema: "SellerSession" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readSellerSession",
    method: "get",
    path: identityAccessV1Paths.readSession,
    auth: "seller-session",
    responses: [
      { status: 200, schema: "SellerSession" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readStoreDraft",
    method: "get",
    path: "/v1/seller/store/draft",
    auth: "seller-session",
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
    auth: "seller-session",
    request: "StoreDraftInput",
    responses: [
      { status: 200, schema: "StoreDraft" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 409, schema: "SlugConflictError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "checkStoreSlugAvailability",
    method: "get",
    path: "/v1/store-slugs/{slug}/availability",
    auth: "seller-session",
    pathParameter: "slug",
    responses: [
      { status: 200, schema: "SlugAvailability" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "uploadStoreMedia",
    method: "post",
    path: "/v1/seller/media",
    auth: "seller-session",
    request: "MediaUploadInput",
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
    operationId: "readMedia",
    method: "get",
    path: "/v1/media/{mediaId}",
    auth: "none",
    pathParameter: "mediaId",
    responses: [
      { status: 200, binaryMedia: true },
      { status: 404, schema: "MediaNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "previewStore",
    method: "get",
    path: "/v1/seller/store/preview",
    auth: "seller-session",
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
    auth: "seller-session",
    responses: [
      { status: 200, schema: "StorePublication" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "StoreNotFoundError" },
      { status: 409, schema: "SlugConflictError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readPublishedStore",
    method: "get",
    path: "/v1/stores/{slug}",
    auth: "none",
    pathParameter: "slug",
    responses: [
      { status: 200, schema: "PublicStore" },
      { status: 404, schema: "StoreNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];
