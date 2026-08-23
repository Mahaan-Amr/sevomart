import {
  createIdentityAccessV1JsonSchemas,
  identityAccessV1Examples,
  identityAccessV1Paths,
} from "@sevo/contracts/identity-access/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const operations = [
  {
    operationId: "requestSellerOtp",
    method: "post",
    path: identityAccessV1Paths.requestOtp,
    tag: "identity-access",
    auth: "none",
    request: {
      schema: "OtpRequest",
      example: identityAccessV1Examples.OtpRequest,
    },
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
    tag: "identity-access",
    auth: "none",
    request: {
      schema: "OtpVerification",
      example: identityAccessV1Examples.OtpVerification,
    },
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
    tag: "identity-access",
    auth: "seller-session",
    responses: [
      { status: 200, schema: "SellerSession" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

const responseMetadata = {
  descriptions: {
    200: "Successful response",
    202: "Request accepted",
    401: "Seller session is missing or invalid",
    422: "Request validation failed",
    500: "Unexpected server error",
  },
  headersBySchema: {
    SellerSession: {
      "Set-Cookie": {
        description: "Creates the HTTP-only seller session cookie.",
        schema: { type: "string" as const },
      },
    },
  },
};

export const contribute_identity_access_openApi: OpenApiContributor = (document) => {
  document.components ??= {};
  document.components.securitySchemes ??= {};
  document.components.securitySchemes.sellerSession = {
    type: "apiKey",
    in: "cookie",
    name: "sevo_seller_session",
    description: "HTTP-only session established after OTP verification.",
  };
  return addModuleOpenApiContract(
    document,
    createIdentityAccessV1JsonSchemas(),
    identityAccessV1Examples,
    operations,
    responseMetadata,
  );
};
