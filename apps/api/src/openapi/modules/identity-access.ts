import {
  createIdentityAccessV1JsonSchemas,
  identityAccessV1Examples,
  identityAccessV1Paths,
  sellerApplicationV1Paths,
  platformSellerApplicationV1Paths,
  platformAgentAuthV1Paths,
  platformAccessV1Paths,
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

const idempotencyHeaderParameters = [
  {
    name: "Idempotency-Key",
    schema: "IdempotencyKey",
    example: identityAccessV1Examples.IdempotencyKey,
    required: true,
  },
] as const;

const platformAccessGrantPathParameter = {
  name: "grantId",
  schema: "PlatformAccessGrantId",
  example: identityAccessV1Examples.PlatformAccessGrantId,
} as const;

const platformAccessListQueryParameters = [
  {
    name: "subjectIdentityId",
    schema: "PlatformAccessSubjectIdentityId",
    example: identityAccessV1Examples.PlatformAccessSubjectIdentityId,
    required: false,
  },
  {
    name: "status",
    schema: "PlatformAccessStatus",
    example: identityAccessV1Examples.PlatformAccessStatus,
    required: false,
  },
  {
    name: "cursor",
    schema: "PlatformAccessCursor",
    example: identityAccessV1Examples.PlatformAccessCursor,
    required: false,
  },
  {
    name: "limit",
    schema: "PlatformAccessPageLimit",
    example: identityAccessV1Examples.PlatformAccessPageLimit,
    required: false,
  },
] as const;

const platformAccessAuditQueryParameters = [
  {
    name: "grantId",
    schema: "PlatformAccessGrantId",
    example: identityAccessV1Examples.PlatformAccessGrantId,
    required: false,
  },
  {
    name: "actorIdentityId",
    schema: "PlatformAccessSubjectIdentityId",
    example: identityAccessV1Examples.PlatformAccessSubjectIdentityId,
    required: false,
  },
  ...platformAccessListQueryParameters.slice(2),
] as const;

const platformAccessMutationResponses = [
  { status: 200, schema: "PlatformAccessGrant" },
  { status: 401, schema: "UnauthorizedError" },
  { status: 403, schema: "PlatformAccessError" },
  { status: 404, schema: "PlatformAccessError" },
  { status: 409, schema: "PlatformAccessError", headers: retryAfterHeader },
  { status: 422, schema: "ValidationError" },
  { status: 500, schema: "InternalServerError" },
] as const;

const platformAccessListResponses = [
  { status: 200, schema: "PlatformAccessGrantPage" },
  { status: 401, schema: "UnauthorizedError" },
  { status: 403, schema: "PlatformAccessError" },
  { status: 422, schema: "ValidationError" },
  { status: 500, schema: "InternalServerError" },
] as const;

const platformAccessRequestResponses = [
  { status: 202, schema: "PlatformAccessGrant" },
  { status: 401, schema: "UnauthorizedError" },
  { status: 403, schema: "PlatformAccessError" },
  { status: 409, schema: "PlatformAccessError", headers: retryAfterHeader },
  { status: 422, schema: "ValidationError" },
  { status: 500, schema: "InternalServerError" },
] as const;

const platformAccessAuditResponses = [
  { status: 200, schema: "PlatformAccessAuditPage" },
  { status: 401, schema: "UnauthorizedError" },
  { status: 403, schema: "PlatformAccessError" },
  { status: 422, schema: "ValidationError" },
  { status: 500, schema: "InternalServerError" },
] as const;

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
    headerParameters: idempotencyHeaderParameters,
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
    headerParameters: idempotencyHeaderParameters,
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
    headerParameters: idempotencyHeaderParameters,
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
    headerParameters: idempotencyHeaderParameters,
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
    operationId: "approvePlatformSellerApplication",
    method: "post",
    path: platformSellerApplicationV1Paths.approve,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: {
      name: "applicationId",
      schema: "SellerApplicationId",
      example: identityAccessV1Examples.SellerApplicationId,
    },
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "ApproveSellerApplication",
      example: identityAccessV1Examples.ApproveSellerApplication,
    },
    responses: [
      { status: 200, schema: "ApproveSellerApplicationResult" },
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
    headerParameters: idempotencyHeaderParameters,
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
  {
    operationId: "requestResponsibilityGrant",
    method: "post",
    path: platformAccessV1Paths.responsibilityGrants,
    tag: "identity-access",
    auth: "platform-agent-session",
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "ResponsibilityGrantRequestInput",
      example: identityAccessV1Examples.ResponsibilityGrantRequestInput,
    },
    responses: platformAccessRequestResponses,
  },
  {
    operationId: "listResponsibilityGrants",
    method: "get",
    path: platformAccessV1Paths.responsibilityGrants,
    tag: "identity-access",
    auth: "platform-agent-session",
    queryParameters: platformAccessListQueryParameters,
    responses: platformAccessListResponses,
  },
  {
    operationId: "approveResponsibilityGrant",
    method: "post",
    path: platformAccessV1Paths.responsibilityGrantApproval,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "PlatformAccessApprovalInput",
      example: identityAccessV1Examples.PlatformAccessApprovalInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "revokeResponsibilityGrant",
    method: "post",
    path: platformAccessV1Paths.responsibilityGrantRevocation,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "PlatformAccessRevocationInput",
      example: identityAccessV1Examples.PlatformAccessRevocationInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "rejectResponsibilityGrant",
    method: "post",
    path: platformAccessV1Paths.responsibilityGrantRejection,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "PlatformAccessRejectionInput",
      example: identityAccessV1Examples.PlatformAccessRejectionInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "requestSensitiveAccess",
    method: "post",
    path: platformAccessV1Paths.sensitiveAccessGrants,
    tag: "identity-access",
    auth: "platform-agent-session",
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "SensitiveAccessRequestInput",
      example: identityAccessV1Examples.SensitiveAccessRequestInput,
    },
    responses: platformAccessRequestResponses,
  },
  {
    operationId: "listSensitiveAccessGrants",
    method: "get",
    path: platformAccessV1Paths.sensitiveAccessGrants,
    tag: "identity-access",
    auth: "platform-agent-session",
    queryParameters: platformAccessListQueryParameters,
    responses: platformAccessListResponses,
  },
  {
    operationId: "approveSensitiveAccess",
    method: "post",
    path: platformAccessV1Paths.sensitiveAccessApproval,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "PlatformAccessApprovalInput",
      example: identityAccessV1Examples.PlatformAccessApprovalInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "revokeSensitiveAccess",
    method: "post",
    path: platformAccessV1Paths.sensitiveAccessRevocation,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "PlatformAccessRevocationInput",
      example: identityAccessV1Examples.PlatformAccessRevocationInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "rejectSensitiveAccess",
    method: "post",
    path: platformAccessV1Paths.sensitiveAccessRejection,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "PlatformAccessRejectionInput",
      example: identityAccessV1Examples.PlatformAccessRejectionInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "requestEmergencyAccess",
    method: "post",
    path: platformAccessV1Paths.emergencyAccessGrants,
    tag: "identity-access",
    auth: "platform-agent-session",
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "EmergencyAccessRequestInput",
      example: identityAccessV1Examples.EmergencyAccessRequestInput,
    },
    responses: platformAccessRequestResponses,
  },
  {
    operationId: "listEmergencyAccessGrants",
    method: "get",
    path: platformAccessV1Paths.emergencyAccessGrants,
    tag: "identity-access",
    auth: "platform-agent-session",
    queryParameters: platformAccessListQueryParameters,
    responses: platformAccessListResponses,
  },
  {
    operationId: "approveEmergencyAccess",
    method: "post",
    path: platformAccessV1Paths.emergencyAccessApproval,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "PlatformAccessApprovalInput",
      example: identityAccessV1Examples.PlatformAccessApprovalInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "activateEmergencyAccess",
    method: "post",
    path: platformAccessV1Paths.emergencyAccessActivation,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "EmergencyAccessActivationInput",
      example: identityAccessV1Examples.EmergencyAccessActivationInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "revokeEmergencyAccess",
    method: "post",
    path: platformAccessV1Paths.emergencyAccessRevocation,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "PlatformAccessRevocationInput",
      example: identityAccessV1Examples.PlatformAccessRevocationInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "closeEmergencyAccess",
    method: "post",
    path: platformAccessV1Paths.emergencyAccessClosure,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "EmergencyAccessClosureInput",
      example: identityAccessV1Examples.EmergencyAccessClosureInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "rejectEmergencyAccess",
    method: "post",
    path: platformAccessV1Paths.emergencyAccessRejection,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "PlatformAccessRejectionInput",
      example: identityAccessV1Examples.PlatformAccessRejectionInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "completeEmergencyAccessReview",
    method: "post",
    path: platformAccessV1Paths.emergencyAccessReview,
    tag: "identity-access",
    auth: "platform-agent-session",
    pathParameter: platformAccessGrantPathParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "EmergencyAccessReviewInput",
      example: identityAccessV1Examples.EmergencyAccessReviewInput,
    },
    responses: platformAccessMutationResponses,
  },
  {
    operationId: "listPlatformAccessAudit",
    method: "get",
    path: platformAccessV1Paths.audit,
    tag: "identity-access",
    auth: "platform-agent-session",
    queryParameters: platformAccessAuditQueryParameters,
    responses: platformAccessAuditResponses,
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
    404: "The requested application or access grant was not found",
    409: "The command conflicts with the current state",
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
      "HTTP-only platform-agent session; every operation rechecks its live responsibility and scoped access grants.",
  };
  return addModuleOpenApiContract(
    document,
    createIdentityAccessV1JsonSchemas(),
    identityAccessV1Examples,
    operations,
    responseMetadata,
  );
};
