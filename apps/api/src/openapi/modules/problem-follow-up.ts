import {
  createProblemFollowUpV1JsonSchemas,
  problemFollowUpV1Examples,
} from "@sevo/contracts/problem-follow-up/v1";
import {
  createProblemFollowUpV2JsonSchemas,
  problemFollowUpV1ReadOperations,
  problemFollowUpV2Examples,
  problemFollowUpV2Operations,
} from "@sevo/contracts/problem-follow-up/v2";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const idempotencyHeader = [
  {
    name: "Idempotency-Key",
    schema: "ProblemFollowUpIdempotencyKey",
    example: problemFollowUpV1Examples.ProblemFollowUpIdempotencyKey,
    required: true,
  },
] as const;

const sensitiveAccessHeaders = [
  {
    name: "X-Platform-Access-Grant-Id",
    schema: "PlatformAccessGrantId",
    example: "6df3e69a-4d9c-4c5b-9bf2-75af372e18e5",
    required: true,
  },
  {
    name: "X-Platform-Access-Reason",
    schema: "ProblemFollowUpAccessReasonV2",
    example: problemFollowUpV2Examples.ProblemFollowUpAccessReasonV2,
    required: true,
  },
] as const;

const paginationQuery = [
  {
    name: "cursor",
    schema: "ProblemFollowUpCursor",
    example: problemFollowUpV1Examples.ProblemFollowUpCursor,
    required: false,
  },
  {
    name: "limit",
    schema: "ProblemFollowUpPageLimit",
    example: problemFollowUpV1Examples.ProblemFollowUpPageLimit,
    required: false,
  },
] as const;

const disputePathParameter = {
  name: "disputeId",
  schema: "DisputeId",
  example: problemFollowUpV1Examples.DisputeId,
} as const;

const operations = [
  {
    ...problemFollowUpV2Operations.openDispute,
    tag: "problem-follow-up",
    auth: "identity-session",
    headerParameters: idempotencyHeader,
    request: {
      schema: "OpenDisputeInputV2",
      example: problemFollowUpV2Examples.OpenDisputeInputV2,
    },
    responses: [
      { status: 201, schema: "BuyerDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "ProblemFollowUpErrorV2" },
      { status: 409, schema: "ProblemFollowUpErrorV2" },
      { status: 428, schema: "ProblemFollowUpErrorV2" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1ReadOperations.readBuyerDispute,
    tag: "problem-follow-up",
    auth: "identity-session",
    pathParameter: disputePathParameter,
    responses: [
      { status: 200, schema: "BuyerDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "ProblemFollowUpError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1ReadOperations.listSellerDisputes,
    tag: "problem-follow-up",
    auth: "identity-session",
    queryParameters: paginationQuery,
    responses: [
      { status: 200, schema: "SellerDisputePage" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "ProblemFollowUpError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1ReadOperations.readSellerDispute,
    tag: "problem-follow-up",
    auth: "identity-session",
    pathParameter: disputePathParameter,
    responses: [
      { status: 200, schema: "SellerDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "ProblemFollowUpError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV2Operations.respondToDispute,
    tag: "problem-follow-up",
    auth: "identity-session",
    pathParameter: disputePathParameter,
    headerParameters: idempotencyHeader,
    request: {
      schema: "RespondToDisputeInputV2",
      example: problemFollowUpV2Examples.RespondToDisputeInputV2,
    },
    responses: [
      { status: 200, schema: "SellerDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "ProblemFollowUpErrorV2" },
      { status: 409, schema: "ProblemFollowUpErrorV2" },
      { status: 428, schema: "ProblemFollowUpErrorV2" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1ReadOperations.listPlatformDisputes,
    tag: "problem-follow-up",
    auth: "platform-agent-session",
    queryParameters: paginationQuery,
    responses: [
      { status: 200, schema: "PlatformDisputeQueue" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "ProblemFollowUpError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1ReadOperations.readPlatformDispute,
    tag: "problem-follow-up",
    auth: "platform-agent-session",
    pathParameter: disputePathParameter,
    headerParameters: sensitiveAccessHeaders,
    responses: [
      { status: 200, schema: "PlatformDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "ProblemFollowUpError" },
      { status: 404, schema: "ProblemFollowUpError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV2Operations.resolveDispute,
    tag: "problem-follow-up",
    auth: "platform-agent-session",
    pathParameter: disputePathParameter,
    headerParameters: [...idempotencyHeader, ...sensitiveAccessHeaders],
    request: {
      schema: "ResolveDisputeInputV2",
      example: problemFollowUpV2Examples.ResolveDisputeInputV2,
    },
    responses: [
      { status: 200, schema: "PlatformDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "ProblemFollowUpErrorV2" },
      { status: 404, schema: "ProblemFollowUpErrorV2" },
      { status: 409, schema: "ProblemFollowUpErrorV2" },
      { status: 428, schema: "ProblemFollowUpErrorV2" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV2Operations.reopenDispute,
    tag: "problem-follow-up",
    auth: "platform-agent-session",
    pathParameter: disputePathParameter,
    headerParameters: [...idempotencyHeader, ...sensitiveAccessHeaders],
    request: {
      schema: "ReopenDisputeInputV2",
      example: problemFollowUpV2Examples.ReopenDisputeInputV2,
    },
    responses: [
      { status: 200, schema: "PlatformDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "ProblemFollowUpErrorV2" },
      { status: 404, schema: "ProblemFollowUpErrorV2" },
      { status: 409, schema: "ProblemFollowUpErrorV2" },
      { status: 428, schema: "ProblemFollowUpErrorV2" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1ReadOperations.listPlatformViolationCases,
    tag: "problem-follow-up",
    auth: "platform-agent-session",
    queryParameters: paginationQuery,
    responses: [
      { status: 200, schema: "PlatformViolationQueue" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "ProblemFollowUpError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1ReadOperations.readPlatformViolationCase,
    tag: "problem-follow-up",
    auth: "platform-agent-session",
    pathParameter: {
      name: "violationCaseId",
      schema: "ViolationCaseId",
      example: problemFollowUpV1Examples.ViolationCaseId,
    },
    headerParameters: sensitiveAccessHeaders,
    responses: [
      { status: 200, schema: "PlatformViolationCaseView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "ProblemFollowUpError" },
      { status: 404, schema: "ProblemFollowUpError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

export const contribute_problem_follow_up_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    {
      ...createProblemFollowUpV1JsonSchemas(),
      ...createProblemFollowUpV2JsonSchemas(),
    },
    { ...problemFollowUpV1Examples, ...problemFollowUpV2Examples },
    operations,
    {
      descriptions: {
        200: "Problem follow-up state returned",
        201: "Dispute opened",
        401: "Identity or platform-agent session is missing or invalid",
        403: "Required responsibility or case-scoped sensitive access is missing",
        404: "Case is unavailable to this identity",
        409: "Deadline, transition, or idempotency conflict",
        422: "Input is invalid",
        428: "Idempotency key is missing or invalid",
        500: "Unexpected server error",
      },
    },
  );
