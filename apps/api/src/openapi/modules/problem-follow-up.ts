import {
  createProblemFollowUpV1JsonSchemas,
  problemFollowUpV1Examples,
  problemFollowUpV1Operations,
} from "@sevo/contracts/problem-follow-up/v1";

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
    ...problemFollowUpV1Operations.openDispute,
    tag: "problem-follow-up",
    auth: "identity-session",
    headerParameters: idempotencyHeader,
    request: {
      schema: "OpenDisputeInput",
      example: problemFollowUpV1Examples.OpenDisputeInput,
    },
    responses: [
      { status: 201, schema: "BuyerDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "ProblemFollowUpError" },
      { status: 409, schema: "ProblemFollowUpError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1Operations.readBuyerDispute,
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
    ...problemFollowUpV1Operations.listSellerDisputes,
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
    ...problemFollowUpV1Operations.readSellerDispute,
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
    ...problemFollowUpV1Operations.respondToDispute,
    tag: "problem-follow-up",
    auth: "identity-session",
    pathParameter: disputePathParameter,
    headerParameters: idempotencyHeader,
    request: {
      schema: "RespondToDisputeInput",
      example: problemFollowUpV1Examples.RespondToDisputeInput,
    },
    responses: [
      { status: 200, schema: "SellerDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "ProblemFollowUpError" },
      { status: 409, schema: "ProblemFollowUpError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1Operations.listPlatformDisputes,
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
    ...problemFollowUpV1Operations.readPlatformDispute,
    tag: "problem-follow-up",
    auth: "platform-agent-session",
    pathParameter: disputePathParameter,
    responses: [
      { status: 200, schema: "PlatformDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "ProblemFollowUpError" },
      { status: 404, schema: "ProblemFollowUpError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1Operations.resolveDispute,
    tag: "problem-follow-up",
    auth: "platform-agent-session",
    pathParameter: disputePathParameter,
    headerParameters: idempotencyHeader,
    request: {
      schema: "ResolveDisputeInput",
      example: problemFollowUpV1Examples.ResolveDisputeInput,
    },
    responses: [
      { status: 200, schema: "PlatformDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "ProblemFollowUpError" },
      { status: 404, schema: "ProblemFollowUpError" },
      { status: 409, schema: "ProblemFollowUpError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1Operations.reopenDispute,
    tag: "problem-follow-up",
    auth: "platform-agent-session",
    pathParameter: disputePathParameter,
    headerParameters: idempotencyHeader,
    request: {
      schema: "ReopenDisputeInput",
      example: problemFollowUpV1Examples.ReopenDisputeInput,
    },
    responses: [
      { status: 200, schema: "PlatformDisputeView" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 403, schema: "ProblemFollowUpError" },
      { status: 404, schema: "ProblemFollowUpError" },
      { status: 409, schema: "ProblemFollowUpError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...problemFollowUpV1Operations.listPlatformViolationCases,
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
    ...problemFollowUpV1Operations.readPlatformViolationCase,
    tag: "problem-follow-up",
    auth: "platform-agent-session",
    pathParameter: {
      name: "violationCaseId",
      schema: "ViolationCaseId",
      example: problemFollowUpV1Examples.ViolationCaseId,
    },
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
    createProblemFollowUpV1JsonSchemas(),
    problemFollowUpV1Examples,
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
        500: "Unexpected server error",
      },
    },
  );
