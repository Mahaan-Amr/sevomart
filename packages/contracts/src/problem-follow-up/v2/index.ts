import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import { identityIdContract, orderIdContract } from "../../platform/v1/index";
import {
  disputeCategoryContract,
  disputeAuditEntryContract,
  disputeAuditIdContract,
  disputeEvidenceIdContract,
  disputeEvidenceKindContract,
  disputeIdContract,
  problemFollowUpIdempotencyKeyContract,
  problemFollowUpV1Operations,
  violationCaseIdContract,
  violationTypeContract,
} from "../v1/index";

export const problemFollowUpV1ReadOperations = {
  listBuyerDisputes: problemFollowUpV1Operations.listBuyerDisputes,
  readBuyerDispute: problemFollowUpV1Operations.readBuyerDispute,
  listSellerDisputes: problemFollowUpV1Operations.listSellerDisputes,
  readSellerDispute: problemFollowUpV1Operations.readSellerDispute,
  listPlatformDisputes: problemFollowUpV1Operations.listPlatformDisputes,
  readPlatformDispute: problemFollowUpV1Operations.readPlatformDispute,
  listPlatformViolationCases: problemFollowUpV1Operations.listPlatformViolationCases,
  readPlatformViolationCase: problemFollowUpV1Operations.readPlatformViolationCase,
} as const;

export const problemFollowUpV2Operations = {
  openDispute: {
    operationId: "openDisputeV2",
    method: "post",
    path: "/v2/buyer/disputes",
  },
  respondToDispute: {
    operationId: "respondToDisputeV2",
    method: "post",
    path: "/v2/seller/disputes/{disputeId}/response",
  },
  resolveDispute: {
    operationId: "resolveDisputeV2",
    method: "post",
    path: "/v2/platform/disputes/{disputeId}/resolution",
  },
  reopenDispute: {
    operationId: "reopenDisputeV2",
    method: "post",
    path: "/v2/platform/disputes/{disputeId}/reopening",
  },
} as const;

export const problemFollowUpAccessReasonV2Contract = z
  .string()
  .trim()
  .min(10)
  .max(1_000);

export const disputeEvidenceInputV2Contract = z
  .object({
    evidenceId: disputeEvidenceIdContract,
    kind: disputeEvidenceKindContract,
  })
  .strict();

export const openDisputeInputV2Contract = z
  .object({
    orderId: orderIdContract,
    category: disputeCategoryContract,
    description: z.string().trim().min(10).max(2_000),
    evidence: z.array(disputeEvidenceInputV2Contract).min(1).max(10),
  })
  .strict();

export const respondToDisputeInputV2Contract = z
  .object({
    response: z.string().trim().min(10).max(2_000),
    evidence: z.array(disputeEvidenceInputV2Contract).max(10),
  })
  .strict();

const resolutionFields = {
  status: z.enum(["RESOLVED", "CLOSED"]),
  explanation: z.string().trim().min(10).max(2_000),
  evidence: z.array(disputeEvidenceInputV2Contract).max(10),
} as const;

export const resolveDisputeInputV2Contract = z.discriminatedUnion("outcomeCode", [
  z
    .object({
      ...resolutionFields,
      outcomeCode: z.literal("VIOLATION_RECORDED"),
      violationType: violationTypeContract,
    })
    .strict(),
  z
    .object({
      ...resolutionFields,
      outcomeCode: z.enum([
        "SELLER_ACTION_AGREED",
        "PARTIES_REACHED_AGREEMENT",
        "POLICY_EXPLAINED",
        "INSUFFICIENT_EVIDENCE",
        "REFERRED_TO_FORMAL_CHANNEL",
      ]),
      violationType: z.never().optional(),
    })
    .strict(),
]);

export const reopenDisputeInputV2Contract = z
  .object({
    reason: z.string().trim().min(10).max(2_000),
    evidence: z.array(disputeEvidenceInputV2Contract).min(1).max(10),
  })
  .strict();

const problemFollowUpCommandContext = {
  actorIdentityId: identityIdContract,
  occurredAt: z.iso.datetime({ offset: true }),
  correlationId: z.uuid(),
  idempotencyKey: problemFollowUpIdempotencyKeyContract,
} as const;

export const openDisputeCommandV2Contract = openDisputeInputV2Contract.extend({
  ...problemFollowUpCommandContext,
  actorKind: z.literal("BUYER"),
});

export const respondToDisputeCommandV2Contract = respondToDisputeInputV2Contract.extend(
  {
    ...problemFollowUpCommandContext,
    actorKind: z.literal("SELLER"),
    disputeId: disputeIdContract,
  },
);

const resolutionCommandFields = {
  ...problemFollowUpCommandContext,
  actorKind: z.literal("PLATFORM_AGENT"),
  disputeId: disputeIdContract,
} as const;

export const resolveDisputeCommandV2Contract = z.discriminatedUnion("outcomeCode", [
  resolveDisputeInputV2Contract.options[0].extend(resolutionCommandFields),
  resolveDisputeInputV2Contract.options[1].extend(resolutionCommandFields),
]);

export const reopenDisputeCommandV2Contract = reopenDisputeInputV2Contract.extend({
  ...problemFollowUpCommandContext,
  actorKind: z.literal("PLATFORM_AGENT"),
  disputeId: disputeIdContract,
});

export const disputeEscalationAuditV2Contract = z
  .object({
    auditId: disputeAuditIdContract,
    disputeId: disputeIdContract,
    action: z.literal("ESCALATE"),
    actorKind: z.literal("PLATFORM_AGENT"),
    actorIdentityId: identityIdContract,
    fromStatus: z.literal("AWAITING_SELLER_RESPONSE"),
    toStatus: z.literal("UNDER_REVIEW"),
    reasonCode: z.literal("SELLER_RESPONSE_DEADLINE_EXPIRED"),
    evidenceCount: z.literal(0),
    occurredAt: z.iso.datetime({ offset: true }),
    correlationId: z.uuid(),
  })
  .strict();

export const disputeAuditEntryV2Contract = z.union([
  disputeAuditEntryContract,
  disputeEscalationAuditV2Contract,
]);

export const problemFollowUpErrorV2Contract = z
  .object({
    code: z.enum([
      "WINDOW_CLOSED",
      "DEADLINE_PASSED",
      "INVALID_TRANSITION",
      "FORBIDDEN",
      "NOT_FOUND",
      "SENSITIVE_ACCESS_REQUIRED",
      "IDEMPOTENCY_CONFLICT",
      "IDEMPOTENCY_IN_PROGRESS",
      "PRECONDITION_REQUIRED",
    ]),
    message: z.string().min(1),
    correlationId: z.string().min(1),
  })
  .strict();

export const problemFollowUpV2Schemas = {
  ProblemFollowUpAccessReasonV2: problemFollowUpAccessReasonV2Contract,
  DisputeEvidenceInputV2: disputeEvidenceInputV2Contract,
  OpenDisputeInputV2: openDisputeInputV2Contract,
  RespondToDisputeInputV2: respondToDisputeInputV2Contract,
  ResolveDisputeInputV2: resolveDisputeInputV2Contract,
  ReopenDisputeInputV2: reopenDisputeInputV2Contract,
  DisputeAuditEntryV2: disputeAuditEntryV2Contract,
  ProblemFollowUpErrorV2: problemFollowUpErrorV2Contract,
} as const;

export function createProblemFollowUpV2JsonSchemas() {
  return createJsonSchemaMap(problemFollowUpV2Schemas);
}

const exampleEvidenceId = "7df3e69a-4d9c-4c5b-9bf2-75af372e18e3";

export const problemFollowUpV2Examples = {
  ProblemFollowUpAccessReasonV2: "بررسی مدارک همین پرونده برای تصمیم ثبت‌شده",
  OpenDisputeInputV2: {
    orderId: "8f6db56b-c451-4993-a243-87f667885d7c",
    category: "DAMAGED",
    description: "کالا هنگام تحویل آسیب‌دیده بود.",
    evidence: [{ evidenceId: exampleEvidenceId, kind: "IMAGE" }],
  },
  RespondToDisputeInputV2: {
    response: "پاسخ فروشگاه همراه با مدرک ارسال ثبت شد.",
    evidence: [],
  },
  ResolveDisputeInputV2: {
    status: "RESOLVED",
    outcomeCode: "VIOLATION_RECORDED",
    explanation: "تخلف ثبت‌شده برای بررسی جداگانه ارسال شد.",
    evidence: [{ evidenceId: exampleEvidenceId, kind: "DOCUMENT" }],
    violationType: "MISREPRESENTATION",
  },
  ReopenDisputeInputV2: {
    reason: "مدرک تازه‌ای پس از اعلام نتیجه دریافت شد.",
    evidence: [{ evidenceId: exampleEvidenceId, kind: "MESSAGE_REFERENCE" }],
  },
} as const;

export type DisputeId = z.infer<typeof disputeIdContract>;
export type ViolationCaseId = z.infer<typeof violationCaseIdContract>;
export type DisputeEvidenceInputV2 = z.infer<typeof disputeEvidenceInputV2Contract>;
export type OpenDisputeInputV2 = z.infer<typeof openDisputeInputV2Contract>;
export type RespondToDisputeInputV2 = z.infer<typeof respondToDisputeInputV2Contract>;
export type ResolveDisputeInputV2 = z.infer<typeof resolveDisputeInputV2Contract>;
export type ReopenDisputeInputV2 = z.infer<typeof reopenDisputeInputV2Contract>;
export type DisputeAuditEntryV2 = z.infer<typeof disputeAuditEntryV2Contract>;
