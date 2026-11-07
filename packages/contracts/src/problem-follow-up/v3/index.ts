import { z } from "zod";
import {
  buyerDisputeViewContract,
  platformDisputeActionContract,
  platformViolationQueueItemContract,
  disputeEvidenceReferenceContract,
  violationReasonCodeContract,
  problemFollowUpV1Examples,
} from "../v1/index";
import { superadminSensitiveReceiptContract } from "../../identity-access/v1/index";
import { createJsonSchemaMap } from "../../json-schema";

const access = superadminSensitiveReceiptContract
  .extend({ mode: z.literal("REVEALED_MINIMUM") })
  .strict();
export const platformDisputeDirectViewContract = buyerDisputeViewContract
  .extend({
    platformAction: platformDisputeActionContract.nullable().optional(),
    access,
  })
  .refine(
    (view) =>
      view.access.scope.resourceType === "DISPUTE_CASE" &&
      view.access.scope.resourceId === view.disputeId &&
      view.access.scope.allowedActions[0] === "REVEAL_MINIMUM",
  );
export const platformViolationDirectViewContract = platformViolationQueueItemContract
  .extend({
    evidence: z.array(disputeEvidenceReferenceContract).max(20),
    actionReasonCodes: z.array(violationReasonCodeContract).max(50),
    access,
  })
  .strict()
  .refine(
    (view) =>
      view.access.scope.resourceType === "VIOLATION_CASE" &&
      view.access.scope.resourceId === view.violationCaseId &&
      view.access.scope.allowedActions[0] === "REVEAL_MINIMUM",
  );

export const problemFollowUpV3Operations = {
  readPlatformDispute: {
    operationId: "readPlatformDisputeDirectV3",
    method: "get",
    path: "/v3/platform/disputes/{disputeId}",
  },
  resolveDispute: {
    operationId: "resolveDisputeDirectV3",
    method: "post",
    path: "/v3/platform/disputes/{disputeId}/resolution",
  },
  reopenDispute: {
    operationId: "reopenDisputeDirectV3",
    method: "post",
    path: "/v3/platform/disputes/{disputeId}/reopening",
  },
  readPlatformViolationCase: {
    operationId: "readPlatformViolationDirectV3",
    method: "get",
    path: "/v3/platform/violations/{violationCaseId}",
  },
} as const;
export const problemFollowUpV3Schemas = {
  PlatformDisputeDirectViewV3: platformDisputeDirectViewContract,
  PlatformViolationDirectViewV3: platformViolationDirectViewContract,
};
const actorIdentityId = "11111111-1111-4111-8111-111111111111";
export const problemFollowUpV3Examples = {
  PlatformDisputeDirectViewV3: {
    ...problemFollowUpV1Examples.PlatformDisputeView,
    access: {
      source: "SUPERADMIN",
      actorIdentityId,
      mode: "REVEALED_MINIMUM",
      scope: problemFollowUpV1Examples.PlatformDisputeView.access.scope,
      accessedAt: "2026-08-27T08:45:00.000Z",
    },
  },
  PlatformViolationDirectViewV3: {
    ...problemFollowUpV1Examples.PlatformViolationCaseView,
    access: {
      source: "SUPERADMIN",
      actorIdentityId,
      mode: "REVEALED_MINIMUM",
      scope: problemFollowUpV1Examples.PlatformViolationCaseView.access.scope,
      accessedAt: "2026-08-27T09:00:00.000Z",
    },
  },
} as const;
export function createProblemFollowUpV3JsonSchemas() {
  return createJsonSchemaMap(problemFollowUpV3Schemas);
}
