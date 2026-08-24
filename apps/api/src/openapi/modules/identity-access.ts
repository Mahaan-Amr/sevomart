import {
  createIdentityAccessV1JsonSchemas,
  identityAccessV1Examples,
  identityAccessV1Paths,
  sellerApplicationV1Paths,
  platformSellerApplicationV1Paths,
  platformAgentAuthV1Paths,
} from "@sevo/contracts/identity-access/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const retryAfterHeader = {
  "Retry-After": {
    description: "Present when an idempotent command with this key is still running.",
    schema: { type: "string" as const },
  },
};

const operations = [
  {
    operationId: "requestIdentityOtp",
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
      { status: 429, schema: "RateLimitError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "verifyIdentityOtp",
    method: "post",
    path: identityAccessV1Paths.verifyOtp,
    tag: "identity-access",
    auth: "none",
    request: {
      schema: "OtpVerification",
      example: identityAccessV1Examples.OtpVerification,
    },
    responses: [
      { status: 200, schema: "IdentitySession" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readIdentitySession",
    method: "get",
    path: identityAccessV1Paths.readSession,
    tag: "identity-access",
    auth: "identity-session",
    responses: [
      { status: 200, schema: "IdentitySession" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "endIdentitySession",
    method: "delete",
    path: identityAccessV1Paths.endSession,
    tag: "identity-access",
    auth: "none",
    responses: [
      { status: 204, noContent: true },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "submitSellerApplication",
    method: "post",
    path: sellerApplicationV1Paths.submit,
    tag: "identity-access",
    auth: "identity-session",
    headerParameters: [
      {
        name: "Idempotency-Key",
        schema: "IdempotencyKey",
        example: identityAccessV1Examples.IdempotencyKey,
        required: true,
      },
    ],
    request: {
      schema: "SellerApplicationInput",
      example: identityAccessV1Examples.SellerApplicationInput,
    },
    responses: [
      { status: 201, schema: "SellerApplicationView" },
      { status: 401, schema: "UnauthorizedError" },
      {
        status: 409,
        schema: "SellerApplicationError",
        headers: retryAfterHeader,
      },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readMySellerApplications",
    method: "get",
    path: sellerApplicationV1Paths.readMine,
    tag: "identity-access",
    auth: "identity-session",
    queryParameters: [
      {
        name: "cursor",
        schema: "SellerApplicationCursor",
        example: identityAccessV1Examples.SellerApplicationCursor,
        required: false,
      },
      {
        name: "limit",
        schema: "SellerApplicationPageLimit",
        example: identityAccessV1Examples.SellerApplicationPageLimit,
        required: false,
      },
    ],
    responses: [
      { status: 200, schema: "MySellerApplications" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 422, schema: "SellerApplicationReadMineError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "resubmitSellerApplication",
    method: "post",
    path: sellerApplicationV1Paths.resubmit,
    tag: "identity-access",
    auth: "identity-session",
    pathParameter: {
      name: "applicationId",
      schema: "SellerApplicationId",
      example: identityAccessV1Examples.SellerApplicationId,
    },
    headerParameters: [
      {
        name: "Idempotency-Key",
        schema: "IdempotencyKey",
        example: identityAccessV1Examples.IdempotencyKey,
        required: true,
      },
    ],
    request: {
      schema: "ResubmitSellerApplication",
      example: identityAccessV1Examples.ResubmitSellerApplication,
    },
    responses: [
      { status: 200, schema: "SellerApplicationView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "SellerApplicationError" },
      {
        status: 409,
        schema: "SellerApplicationError",
        headers: retryAfterHeader,
      },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "withdrawSellerApplication",
    method: "post",
    path: sellerApplicationV1Paths.withdraw,
    tag: "identity-access",
    auth: "identity-session",
    pathParameter: {
      name: "applicationId",
      schema: "SellerApplicationId",
      example: identityAccessV1Examples.SellerApplicationId,
    },
    headerParameters: [
      {
        name: "Idempotency-Key",
        schema: "IdempotencyKey",
        example: identityAccessV1Examples.IdempotencyKey,
        required: true,
      },
    ],
    request: {
      schema: "WithdrawSellerApplication",
      example: identityAccessV1Examples.WithdrawSellerApplication,
    },
    responses: [
      { status: 200, schema: "SellerApplicationView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "SellerApplicationError" },
      {
        status: 409,
        schema: "SellerApplicationError",
        headers: retryAfterHeader,
      },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "requestPlatformAgentOtp",
    method: "post",
    path: platformAgentAuthV1Paths.requestOtp,
    tag: "identity-access",
    auth: "none",
    request: {
      schema: "OtpRequest",
      example: identityAccessV1Examples.OtpRequest,
    },
    responses: [
      { status: 202, schema: "OtpChallenge" },
      { status: 403, schema: "SellerApplicationError" },
      { status: 422, schema: "ValidationError" },
      { status: 429, schema: "RateLimitError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "verifyPlatformAgentOtp",
    method: "post",
    path: platformAgentAuthV1Paths.verifyOtp,
    tag: "identity-access",
    auth: "none",
    request: {
      schema: "OtpVerification",
      example: identityAccessV1Examples.OtpVerification,
    },
    responses: [
      { status: 200, schema: "PlatformAgentSession" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "SellerApplicationError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "listPlatformSellerApplications",
    method: "get",
    path: platformSellerApplicationV1Paths.list,
    tag: "identity-access",
    auth: "platform-agent-session",
    queryParameters: [
      {
        name: "status",
        schema: "SellerApplicationStatus",
        example: identityAccessV1Examples.SellerApplicationStatus,
        required: false,
      },
      {
        name: "cursor",
        schema: "SellerApplicationCursor",
        example: identityAccessV1Examples.SellerApplicationCursor,
        required: false,
      },
      {
        name: "limit",
        schema: "SellerApplicationPageLimit",
        example: identityAccessV1Examples.SellerApplicationPageLimit,
        required: false,
      },
    ],
    responses: [
      { status: 200, schema: "PlatformSellerApplicationPage" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "SellerApplicationError" },
      { status: 422, schema: "SellerApplicationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readPlatformSellerApplication",
    method: "get",
    path: platformSellerApplicationV1Paths.read,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: {
      name: "applicationId",
      schema: "SellerApplicationId",
      example: identityAccessV1Examples.SellerApplicationId,
    },
    responses: [
      { status: 200, schema: "PlatformSellerApplicationView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "SellerApplicationError" },
      { status: 404, schema: "SellerApplicationError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "requestPlatformSellerApplicationInformation",
    method: "post",
    path: platformSellerApplicationV1Paths.requestInformation,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: {
      name: "applicationId",
      schema: "SellerApplicationId",
      example: identityAccessV1Examples.SellerApplicationId,
    },
    headerParameters: [
      {
        name: "Idempotency-Key",
        schema: "IdempotencyKey",
        example: identityAccessV1Examples.IdempotencyKey,
        required: true,
      },
    ],
    request: {
      schema: "RequestSellerApplicationInformation",
      example: identityAccessV1Examples.RequestSellerApplicationInformation,
    },
    responses: [
      { status: 200, schema: "PlatformSellerApplicationView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "SellerApplicationError" },
      { status: 404, schema: "SellerApplicationError" },
      { status: 409, schema: "SellerApplicationError", headers: retryAfterHeader },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "rejectPlatformSellerApplication",
    method: "post",
    path: platformSellerApplicationV1Paths.reject,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: {
      name: "applicationId",
      schema: "SellerApplicationId",
      example: identityAccessV1Examples.SellerApplicationId,
    },
    headerParameters: [
      {
        name: "Idempotency-Key",
        schema: "IdempotencyKey",
        example: identityAccessV1Examples.IdempotencyKey,
        required: true,
      },
    ],
    request: {
      schema: "RejectSellerApplication",
      example: identityAccessV1Examples.RejectSellerApplication,
    },
    responses: [
      { status: 200, schema: "PlatformSellerApplicationView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "SellerApplicationError" },
      { status: 404, schema: "SellerApplicationError" },
      { status: 409, schema: "SellerApplicationError", headers: retryAfterHeader },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

const responseMetadata = {
  descriptions: {
    200: "Successful response",
    201: "Seller application submitted",
    202: "Request accepted",
    204: "Session ended",
    401: "Identity session is missing or invalid",
    403: "Platform permission is missing or self-review is forbidden",
    404: "Seller application was not found",
    409: "Seller application command conflicts with current state",
    429: "Request rate limit exceeded",
    422: "Request validation failed",
    500: "Unexpected server error",
  },
  headersBySchema: {
    IdentitySession: {
      "Set-Cookie": {
        description: "Creates the HTTP-only identity session cookie.",
        schema: { type: "string" as const },
      },
    },
    PlatformAgentSession: {
      "Set-Cookie": {
        description: "Creates the isolated HTTP-only platform-agent session cookie.",
        schema: { type: "string" as const },
      },
    },
  },
};

export const contribute_identity_access_openApi: OpenApiContributor = (document) => {
  document.components ??= {};
  document.components.securitySchemes ??= {};
  document.components.securitySchemes.identitySession = {
    type: "apiKey",
    in: "cookie",
    name: "sevo_session",
    description:
      "HTTP-only public identity session established after OTP verification.",
  };
  document.components.securitySchemes.platformAgentSession = {
    type: "apiKey",
    in: "cookie",
    name: "sevo_platform_session",
    description:
      "HTTP-only platform-agent session with a live seller-application review grant.",
  };
  return addModuleOpenApiContract(
    document,
    createIdentityAccessV1JsonSchemas(),
    identityAccessV1Examples,
    operations,
    responseMetadata,
  );
};
