import { z } from "zod";

import {
  platformAccessGrantIdContract,
  platformAccessScopeContract,
} from "../../identity-access/v1/index";
import { createJsonSchemaMap } from "../../json-schema";
import {
  eventEnvelopeV1Contract,
  identityIdContract,
  orderIdContract,
  storeIdContract,
  timestampV1Contract,
} from "../../platform/v1/index";

export const DISPUTE_DELIVERED_OPEN_WINDOW_DAYS = 7;
export const DISPUTE_SHIPPED_OPEN_WINDOW_DAYS = 14;
export const DISPUTE_SELLER_FIRST_RESPONSE_HOURS = 48;
export const DISPUTE_REOPEN_WINDOW_DAYS = 7;

export const disputeStatusContract = z.enum([
  "DRAFT",
  "SUBMITTED",
  "AWAITING_SELLER_RESPONSE",
  "UNDER_REVIEW",
  "RESOLVED",
  "CLOSED",
]);

export const disputeTransitionActionContract = z.enum([
  "OPEN",
  "RESPOND",
  "RESOLVE",
  "REOPEN",
]);

export const disputeActorKindContract = z.enum(["BUYER", "SELLER", "PLATFORM_AGENT"]);

export const disputeIdContract = z.uuid().brand<"DisputeId">();
export const disputeEvidenceIdContract = z.uuid().brand<"DisputeEvidenceId">();
export const disputeCategoryContract = z.enum([
  "DELIVERY_NOT_RECEIVED",
  "DAMAGED",
  "NOT_AS_DESCRIBED",
  "WRONG_ITEM",
  "REFUND_NOT_COMPLETED",
]);
export const violationTypeContract = z.enum([
  "FULFILLMENT_NONCOMPLIANCE",
  "MISREPRESENTATION",
  "REFUND_NONCOMPLIANCE",
  "REPEATED_DISPUTES",
  "PLATFORM_POLICY_BREACH",
]);
export const disputeDeadlineKindContract = z.enum([
  "SELLER_FIRST_RESPONSE",
  "PLATFORM_REVIEW",
  "REOPEN_WINDOW",
]);
export const disputeDeadlineContract = z
  .object({
    kind: disputeDeadlineKindContract,
    dueAt: timestampV1Contract,
  })
  .strict();
export const disputeNextActionCodeContract = z.enum([
  "SUBMIT_FIRST_RESPONSE",
  "REVIEW_CASE",
  "WAIT_FOR_PLATFORM",
  "NO_ACTION",
]);
export const disputeNextActionContract = z
  .object({
    actorKind: disputeActorKindContract.nullable(),
    code: disputeNextActionCodeContract,
  })
  .strict();
export const disputeEvidenceKindContract = z.enum([
  "IMAGE",
  "DOCUMENT",
  "MESSAGE_REFERENCE",
]);
export const disputeEvidenceReferenceContract = z
  .object({
    evidenceId: disputeEvidenceIdContract,
    kind: disputeEvidenceKindContract,
    submittedAt: timestampV1Contract,
  })
  .strict();
export const disputeEvidenceInputContract = disputeEvidenceReferenceContract
  .pick({ evidenceId: true, kind: true })
  .strict();
export const disputeContributionContract = z
  .object({
    authorKind: disputeActorKindContract,
    text: z.string().trim().min(1).max(2_000),
    evidence: z.array(disputeEvidenceReferenceContract).max(10),
    submittedAt: timestampV1Contract,
  })
  .strict();
export const disputeOutcomeCodeContract = z.enum([
  "SELLER_ACTION_AGREED",
  "PARTIES_REACHED_AGREEMENT",
  "POLICY_EXPLAINED",
  "VIOLATION_RECORDED",
  "INSUFFICIENT_EVIDENCE",
  "REFERRED_TO_FORMAL_CHANNEL",
]);
export const disputeOutcomeContract = z
  .object({
    code: disputeOutcomeCodeContract,
    explanation: z.string().trim().min(1).max(2_000),
    decidedAt: timestampV1Contract,
  })
  .strict();

const relatedPartyDisputeViewContract = z
  .object({
    disputeId: disputeIdContract,
    orderId: orderIdContract,
    storeId: storeIdContract,
    status: disputeStatusContract,
    category: disputeCategoryContract,
    openedAt: timestampV1Contract,
    deadline: disputeDeadlineContract.nullable(),
    nextAction: disputeNextActionContract,
    contributions: z.array(disputeContributionContract).min(1),
    outcome: disputeOutcomeContract.nullable(),
  })
  .strict();

export const buyerDisputeViewContract = relatedPartyDisputeViewContract;
export const sellerDisputeViewContract = relatedPartyDisputeViewContract;

export const platformDisputeQueueItemContract = z
  .object({
    disputeId: disputeIdContract,
    status: disputeStatusContract,
    category: disputeCategoryContract,
    openedAt: timestampV1Contract,
    deadline: disputeDeadlineContract.nullable(),
    nextAction: disputeNextActionContract,
  })
  .strict();

export const disputeAuditIdContract = z.uuid().brand<"DisputeAuditId">();
export const disputeAuditReasonCodeContract = z.enum([
  "BUYER_OPENED_CASE",
  "SELLER_SUBMITTED_RESPONSE",
  "PLATFORM_RESOLVED_CASE",
  "PLATFORM_CLOSED_CASE",
  "NEW_EVIDENCE_RECEIVED",
]);
export const disputeAuditEntryContract = z
  .object({
    auditId: disputeAuditIdContract,
    disputeId: disputeIdContract,
    action: disputeTransitionActionContract,
    actorKind: disputeActorKindContract,
    actorIdentityId: identityIdContract,
    fromStatus: disputeStatusContract.nullable(),
    toStatus: disputeStatusContract,
    reasonCode: disputeAuditReasonCodeContract,
    evidenceCount: z.int().nonnegative().max(10),
    occurredAt: timestampV1Contract,
    correlationId: z.uuid(),
  })
  .strict()
  .superRefine((audit, context) => {
    const result = disputeTransitionContract.safeParse({
      action: audit.action,
      actorKind: audit.actorKind,
      actorIdentityId: audit.actorIdentityId,
      fromStatus: audit.fromStatus,
      toStatus: audit.toStatus,
    });
    if (!result.success) {
      context.addIssue({ code: "custom", message: "invalid audited transition" });
    }
    const expectedReason =
      audit.action === "OPEN"
        ? "BUYER_OPENED_CASE"
        : audit.action === "RESPOND"
          ? "SELLER_SUBMITTED_RESPONSE"
          : audit.action === "REOPEN"
            ? "NEW_EVIDENCE_RECEIVED"
            : audit.toStatus === "RESOLVED"
              ? "PLATFORM_RESOLVED_CASE"
              : "PLATFORM_CLOSED_CASE";
    if (audit.reasonCode !== expectedReason) {
      context.addIssue({ code: "custom", message: "audit reason mismatch" });
    }
  });

const disputeOpenedPayloadContract = z
  .object({
    disputeId: disputeIdContract,
    orderId: orderIdContract,
    storeId: storeIdContract,
    category: disputeCategoryContract,
    status: z.literal("AWAITING_SELLER_RESPONSE"),
    deadlineAt: timestampV1Contract,
  })
  .strict();

export const disputeOpenedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DisputeOpened.v1"),
  payload: disputeOpenedPayloadContract,
});

const disputeRespondedPayloadContract = z
  .object({
    disputeId: disputeIdContract,
    fromStatus: z.literal("AWAITING_SELLER_RESPONSE"),
    toStatus: z.literal("UNDER_REVIEW"),
    nextDeadlineAt: timestampV1Contract.nullable(),
    reasonCode: z.literal("SELLER_SUBMITTED_RESPONSE"),
  })
  .strict();
const disputeResolvedPayloadContract = z
  .object({
    disputeId: disputeIdContract,
    fromStatus: z.enum(["AWAITING_SELLER_RESPONSE", "UNDER_REVIEW"]),
    toStatus: z.enum(["RESOLVED", "CLOSED"]),
    nextDeadlineAt: timestampV1Contract,
    reasonCode: z.enum(["PLATFORM_RESOLVED_CASE", "PLATFORM_CLOSED_CASE"]),
  })
  .strict()
  .superRefine((payload, context) => {
    const expectedReason =
      payload.toStatus === "RESOLVED"
        ? "PLATFORM_RESOLVED_CASE"
        : "PLATFORM_CLOSED_CASE";
    if (payload.reasonCode !== expectedReason) {
      context.addIssue({ code: "custom", message: "resolution reason mismatch" });
    }
  });
const disputeReopenedPayloadContract = z
  .object({
    disputeId: disputeIdContract,
    fromStatus: z.enum(["RESOLVED", "CLOSED"]),
    toStatus: z.literal("UNDER_REVIEW"),
    nextDeadlineAt: timestampV1Contract.nullable(),
    reasonCode: z.literal("NEW_EVIDENCE_RECEIVED"),
  })
  .strict();

export const disputeRespondedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DisputeResponded.v1"),
  payload: disputeRespondedPayloadContract,
});
export const disputeResolvedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DisputeResolved.v1"),
  payload: disputeResolvedPayloadContract,
});
export const disputeReopenedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DisputeReopened.v1"),
  payload: disputeReopenedPayloadContract,
});

export const violationCaseIdContract = z.uuid().brand<"ViolationCaseId">();
export const violationCaseStatusContract = z.enum([
  "OPEN",
  "UNDER_REVIEW",
  "RESOLVED",
  "CLOSED",
]);

export const problemFollowUpV1Operations = {
  openDispute: {
    operationId: "openDispute",
    method: "post",
    path: "/v1/buyer/disputes",
  },
  readBuyerDispute: {
    operationId: "readBuyerDispute",
    method: "get",
    path: "/v1/buyer/disputes/{disputeId}",
  },
  listSellerDisputes: {
    operationId: "listSellerDisputes",
    method: "get",
    path: "/v1/seller/disputes",
  },
  readSellerDispute: {
    operationId: "readSellerDispute",
    method: "get",
    path: "/v1/seller/disputes/{disputeId}",
  },
  respondToDispute: {
    operationId: "respondToDispute",
    method: "post",
    path: "/v1/seller/disputes/{disputeId}/response",
  },
  listPlatformDisputes: {
    operationId: "listPlatformDisputes",
    method: "get",
    path: "/v1/platform/disputes",
  },
  readPlatformDispute: {
    operationId: "readPlatformDispute",
    method: "get",
    path: "/v1/platform/disputes/{disputeId}",
  },
  resolveDispute: {
    operationId: "resolveDispute",
    method: "post",
    path: "/v1/platform/disputes/{disputeId}/resolution",
  },
  reopenDispute: {
    operationId: "reopenDispute",
    method: "post",
    path: "/v1/platform/disputes/{disputeId}/reopening",
  },
  listPlatformViolationCases: {
    operationId: "listPlatformViolationCases",
    method: "get",
    path: "/v1/platform/violations",
  },
  readPlatformViolationCase: {
    operationId: "readPlatformViolationCase",
    method: "get",
    path: "/v1/platform/violations/{violationCaseId}",
  },
} as const;

export const problemFollowUpIdempotencyKeyContract = z.string().min(1).max(200);
export const problemFollowUpCursorContract = z.string().min(1).max(500);
export const problemFollowUpPageLimitContract = z.int().min(1).max(100);
export const problemFollowUpAccessReasonContract = z.string().trim().min(10).max(1_000);

export const openDisputeInputContract = z
  .object({
    orderId: orderIdContract,
    category: disputeCategoryContract,
    description: z.string().trim().min(10).max(2_000),
    evidence: z.array(disputeEvidenceInputContract).min(1).max(10),
  })
  .strict();
export const respondToDisputeInputContract = z
  .object({
    response: z.string().trim().min(10).max(2_000),
    evidence: z.array(disputeEvidenceInputContract).max(10),
  })
  .strict();
export const resolveDisputeInputContract = z
  .object({
    status: z.enum(["RESOLVED", "CLOSED"]),
    outcomeCode: disputeOutcomeCodeContract,
    explanation: z.string().trim().min(10).max(2_000),
    evidence: z.array(disputeEvidenceInputContract).max(10),
    violationType: violationTypeContract.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const requiresType = input.outcomeCode === "VIOLATION_RECORDED";
    if (requiresType !== Boolean(input.violationType)) {
      context.addIssue({
        code: "custom",
        path: ["violationType"],
        message: requiresType
          ? "violation type is required for a recorded violation"
          : "violation type is only allowed for a recorded violation",
      });
    }
  });
export const reopenDisputeInputContract = z
  .object({
    reason: z.string().trim().min(10).max(2_000),
    evidence: z.array(disputeEvidenceInputContract).min(1).max(10),
  })
  .strict();

const problemFollowUpCommandContext = {
  actorIdentityId: identityIdContract,
  occurredAt: timestampV1Contract,
  correlationId: z.uuid(),
  idempotencyKey: problemFollowUpIdempotencyKeyContract,
} as const;

export const openDisputeCommandContract = openDisputeInputContract.extend({
  ...problemFollowUpCommandContext,
  actorKind: z.literal("BUYER"),
});
export const respondToDisputeCommandContract = respondToDisputeInputContract.extend({
  ...problemFollowUpCommandContext,
  actorKind: z.literal("SELLER"),
  disputeId: disputeIdContract,
});
export const resolveDisputeCommandContract = resolveDisputeInputContract.extend({
  ...problemFollowUpCommandContext,
  actorKind: z.literal("PLATFORM_AGENT"),
  disputeId: disputeIdContract,
});
export const reopenDisputeCommandContract = reopenDisputeInputContract.extend({
  ...problemFollowUpCommandContext,
  actorKind: z.literal("PLATFORM_AGENT"),
  disputeId: disputeIdContract,
});

export const buyerDisputePageContract = z
  .object({
    items: z.array(buyerDisputeViewContract),
    nextCursor: problemFollowUpCursorContract.nullable(),
  })
  .strict();
export const sellerDisputePageContract = z
  .object({
    items: z.array(sellerDisputeViewContract),
    nextCursor: problemFollowUpCursorContract.nullable(),
  })
  .strict();
export const platformDisputeQueueContract = z
  .object({
    items: z.array(platformDisputeQueueItemContract),
    nextCursor: problemFollowUpCursorContract.nullable(),
  })
  .strict();
const caseScopedSensitiveAccessContract = z
  .object({
    grantId: platformAccessGrantIdContract,
    mode: z.literal("REVEALED_MINIMUM"),
    scope: platformAccessScopeContract,
    accessedAt: timestampV1Contract,
    expiresAt: timestampV1Contract,
  })
  .strict()
  .superRefine((access, context) => {
    if (!access.scope.allowedActions.includes("REVEAL_MINIMUM")) {
      context.addIssue({ code: "custom", message: "minimum reveal is not allowed" });
    }
    if (Date.parse(access.expiresAt) <= Date.parse(access.accessedAt)) {
      context.addIssue({ code: "custom", message: "sensitive access has expired" });
    }
  });
export const platformDisputeViewContract = relatedPartyDisputeViewContract
  .extend({ access: caseScopedSensitiveAccessContract })
  .superRefine((view, context) => {
    if (
      view.access.scope.resourceType !== "DISPUTE_CASE" ||
      view.access.scope.resourceId !== view.disputeId
    ) {
      context.addIssue({ code: "custom", message: "access scope does not match case" });
    }
  });

export const violationSourceContract = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DISPUTE"), disputeId: disputeIdContract }).strict(),
  z.object({ kind: z.literal("ORDER"), orderId: orderIdContract }).strict(),
  z.object({ kind: z.literal("OPERATIONAL_REPORT"), referenceId: z.uuid() }).strict(),
]);
export const violationNextActionCodeContract = z.enum([
  "START_REVIEW",
  "REVIEW_EVIDENCE",
  "RECORD_ACTION",
  "NO_ACTION",
]);
export const violationReasonCodeContract = z.enum([
  "VIOLATION_RECORDED",
  "CASE_NOTE_ADDED",
  "FOLLOW_UP_UPDATED",
]);
export const platformViolationQueueItemContract = z
  .object({
    violationCaseId: violationCaseIdContract,
    type: violationTypeContract,
    source: violationSourceContract,
    status: violationCaseStatusContract,
    openedAt: timestampV1Contract,
    deadlineAt: timestampV1Contract.nullable(),
    nextActionCode: violationNextActionCodeContract,
  })
  .strict();
export const platformViolationQueueContract = z
  .object({
    items: z.array(platformViolationQueueItemContract),
    nextCursor: problemFollowUpCursorContract.nullable(),
  })
  .strict();
export const platformViolationCaseViewContract = platformViolationQueueItemContract
  .extend({
    evidence: z.array(disputeEvidenceReferenceContract).max(20),
    actionReasonCodes: z.array(violationReasonCodeContract).max(50),
    access: caseScopedSensitiveAccessContract,
  })
  .strict()
  .superRefine((view, context) => {
    if (
      view.access.scope.resourceType !== "VIOLATION_CASE" ||
      view.access.scope.resourceId !== view.violationCaseId
    ) {
      context.addIssue({ code: "custom", message: "access scope does not match case" });
    }
  });

const violationCaseOpenedPayloadContract = z
  .object({
    violationCaseId: violationCaseIdContract,
    type: violationTypeContract,
    source: violationSourceContract,
    status: z.literal("OPEN"),
    deadlineAt: timestampV1Contract.nullable(),
  })
  .strict();
export const violationRecordedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("ViolationRecorded.v1"),
  payload: violationCaseOpenedPayloadContract,
});
export const violationAuditActionContract = z.enum([
  "RECORD_VIOLATION",
  "ADD_CASE_NOTE",
  "UPDATE_FOLLOW_UP",
]);
export const violationCaseAuditEntryContract = z
  .object({
    auditId: z.uuid().brand<"ViolationCaseAuditId">(),
    violationCaseId: violationCaseIdContract,
    actorIdentityId: identityIdContract,
    action: violationAuditActionContract,
    status: violationCaseStatusContract,
    reasonCode: violationReasonCodeContract,
    evidenceCount: z.int().nonnegative().max(20),
    occurredAt: timestampV1Contract,
    correlationId: z.uuid(),
  })
  .strict()
  .superRefine((audit, context) => {
    const expectedReason =
      audit.action === "RECORD_VIOLATION"
        ? "VIOLATION_RECORDED"
        : audit.action === "ADD_CASE_NOTE"
          ? "CASE_NOTE_ADDED"
          : "FOLLOW_UP_UPDATED";
    if (audit.reasonCode !== expectedReason) {
      context.addIssue({ code: "custom", message: "audit reason mismatch" });
    }
  });

export const problemFollowUpErrorContract = z
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

export const problemFollowUpV1Schemas = {
  DisputeId: disputeIdContract,
  ViolationCaseId: violationCaseIdContract,
  ProblemFollowUpIdempotencyKey: problemFollowUpIdempotencyKeyContract,
  ProblemFollowUpCursor: problemFollowUpCursorContract,
  ProblemFollowUpPageLimit: problemFollowUpPageLimitContract,
  ProblemFollowUpAccessReason: problemFollowUpAccessReasonContract,
  DisputeStatus: disputeStatusContract,
  ViolationCaseStatus: violationCaseStatusContract,
  OpenDisputeInput: openDisputeInputContract,
  RespondToDisputeInput: respondToDisputeInputContract,
  ResolveDisputeInput: resolveDisputeInputContract,
  ReopenDisputeInput: reopenDisputeInputContract,
  BuyerDisputeView: buyerDisputeViewContract,
  BuyerDisputePage: buyerDisputePageContract,
  SellerDisputeView: sellerDisputeViewContract,
  SellerDisputePage: sellerDisputePageContract,
  PlatformDisputeQueue: platformDisputeQueueContract,
  PlatformDisputeView: platformDisputeViewContract,
  PlatformViolationQueue: platformViolationQueueContract,
  PlatformViolationCaseView: platformViolationCaseViewContract,
  ProblemFollowUpError: problemFollowUpErrorContract,
  DisputeOpenedV1: disputeOpenedV1Contract,
  DisputeRespondedV1: disputeRespondedV1Contract,
  DisputeResolvedV1: disputeResolvedV1Contract,
  DisputeReopenedV1: disputeReopenedV1Contract,
  ViolationRecordedV1: violationRecordedV1Contract,
} as const;

export function createProblemFollowUpV1JsonSchemas() {
  return createJsonSchemaMap(problemFollowUpV1Schemas);
}

const exampleDispute = {
  disputeId: "4df3e69a-4d9c-4c5b-9bf2-75af372e18e1",
  orderId: "8f6db56b-c451-4993-a243-87f667885d7c",
  storeId: "9df3e69a-4d9c-4c5b-9bf2-75af372e18e2",
  status: "AWAITING_SELLER_RESPONSE",
  category: "DAMAGED",
  openedAt: "2026-08-27T08:30:00.000Z",
  deadline: {
    kind: "SELLER_FIRST_RESPONSE",
    dueAt: "2026-08-29T08:30:00.000Z",
  },
  nextAction: { actorKind: "SELLER", code: "SUBMIT_FIRST_RESPONSE" },
  contributions: [
    {
      authorKind: "BUYER",
      text: "کالا هنگام تحویل آسیب‌دیده بود.",
      evidence: [
        {
          evidenceId: "7df3e69a-4d9c-4c5b-9bf2-75af372e18e3",
          kind: "IMAGE",
          submittedAt: "2026-08-27T08:30:00.000Z",
        },
      ],
      submittedAt: "2026-08-27T08:30:00.000Z",
    },
  ],
  outcome: null,
} as const;

const exampleViolation = {
  violationCaseId: "5df3e69a-4d9c-4c5b-9bf2-75af372e18e4",
  type: "FULFILLMENT_NONCOMPLIANCE",
  source: { kind: "DISPUTE", disputeId: exampleDispute.disputeId },
  status: "OPEN",
  openedAt: "2026-08-27T09:00:00.000Z",
  deadlineAt: null,
  nextActionCode: "START_REVIEW",
} as const;

export const problemFollowUpV1Examples = {
  DisputeId: exampleDispute.disputeId,
  ViolationCaseId: exampleViolation.violationCaseId,
  ProblemFollowUpIdempotencyKey: "dispute-action-01",
  ProblemFollowUpCursor: "next-page-token",
  ProblemFollowUpPageLimit: 25,
  ProblemFollowUpAccessReason: "بررسی مدارک همین پرونده برای تصمیم ثبت‌شده",
  DisputeStatus: "AWAITING_SELLER_RESPONSE",
  ViolationCaseStatus: "OPEN",
  OpenDisputeInput: {
    orderId: exampleDispute.orderId,
    category: "DAMAGED",
    description: "کالا هنگام تحویل آسیب‌دیده بود.",
    evidence: [
      {
        evidenceId: exampleDispute.contributions[0].evidence[0].evidenceId,
        kind: "IMAGE",
      },
    ],
  },
  RespondToDisputeInput: {
    response: "پاسخ فروشگاه همراه با مدرک ارسال ثبت شد.",
    evidence: [],
  },
  ResolveDisputeInput: {
    status: "RESOLVED",
    outcomeCode: "SELLER_ACTION_AGREED",
    explanation: "فروشگاه اقدام توافق‌شده را ثبت کرده است.",
    evidence: [],
  },
  ReopenDisputeInput: {
    reason: "مدرک تازه‌ای پس از اعلام نتیجه دریافت شد.",
    evidence: [
      {
        evidenceId: exampleDispute.contributions[0].evidence[0].evidenceId,
        kind: "IMAGE",
      },
    ],
  },
  BuyerDisputeView: exampleDispute,
  BuyerDisputePage: { items: [exampleDispute], nextCursor: null },
  SellerDisputeView: exampleDispute,
  SellerDisputePage: { items: [exampleDispute], nextCursor: null },
  PlatformDisputeQueue: {
    items: [
      {
        disputeId: exampleDispute.disputeId,
        status: exampleDispute.status,
        category: exampleDispute.category,
        openedAt: exampleDispute.openedAt,
        deadline: exampleDispute.deadline,
        nextAction: exampleDispute.nextAction,
      },
    ],
    nextCursor: null,
  },
  PlatformDisputeView: {
    ...exampleDispute,
    access: {
      grantId: "6df3e69a-4d9c-4c5b-9bf2-75af372e18e5",
      mode: "REVEALED_MINIMUM",
      scope: {
        resourceType: "DISPUTE_CASE",
        resourceId: exampleDispute.disputeId,
        allowedActions: ["REVEAL_MINIMUM"],
      },
      accessedAt: "2026-08-27T08:45:00.000Z",
      expiresAt: "2026-08-27T09:00:00.000Z",
    },
  },
  PlatformViolationQueue: { items: [exampleViolation], nextCursor: null },
  PlatformViolationCaseView: {
    ...exampleViolation,
    evidence: [],
    actionReasonCodes: [],
    access: {
      grantId: "6df3e69a-4d9c-4c5b-9bf2-75af372e18e5",
      mode: "REVEALED_MINIMUM",
      scope: {
        resourceType: "VIOLATION_CASE",
        resourceId: exampleViolation.violationCaseId,
        allowedActions: ["REVEAL_MINIMUM"],
      },
      accessedAt: "2026-08-27T09:00:00.000Z",
      expiresAt: "2026-08-27T09:30:00.000Z",
    },
  },
  ProblemFollowUpError: {
    code: "INVALID_TRANSITION",
    message: "این تغییر با وضعیت فعلی پرونده سازگار نیست.",
    correlationId: "request-correlation-01",
  },
} as const;

const allowedDisputeTransitions = [
  {
    action: "OPEN",
    actorKind: "BUYER",
    fromStatus: null,
    toStatus: "AWAITING_SELLER_RESPONSE",
  },
  {
    action: "RESPOND",
    actorKind: "SELLER",
    fromStatus: "AWAITING_SELLER_RESPONSE",
    toStatus: "UNDER_REVIEW",
  },
  {
    action: "RESOLVE",
    actorKind: "PLATFORM_AGENT",
    fromStatus: "AWAITING_SELLER_RESPONSE",
    toStatus: "RESOLVED",
  },
  {
    action: "RESOLVE",
    actorKind: "PLATFORM_AGENT",
    fromStatus: "AWAITING_SELLER_RESPONSE",
    toStatus: "CLOSED",
  },
  {
    action: "RESOLVE",
    actorKind: "PLATFORM_AGENT",
    fromStatus: "UNDER_REVIEW",
    toStatus: "RESOLVED",
  },
  {
    action: "RESOLVE",
    actorKind: "PLATFORM_AGENT",
    fromStatus: "UNDER_REVIEW",
    toStatus: "CLOSED",
  },
  {
    action: "REOPEN",
    actorKind: "PLATFORM_AGENT",
    fromStatus: "RESOLVED",
    toStatus: "UNDER_REVIEW",
  },
  {
    action: "REOPEN",
    actorKind: "PLATFORM_AGENT",
    fromStatus: "CLOSED",
    toStatus: "UNDER_REVIEW",
  },
] as const;

export const disputeTransitionContract = z
  .object({
    action: disputeTransitionActionContract,
    actorKind: disputeActorKindContract,
    actorIdentityId: identityIdContract,
    fromStatus: disputeStatusContract.nullable(),
    toStatus: disputeStatusContract,
  })
  .strict()
  .superRefine((transition, context) => {
    const isAllowed = allowedDisputeTransitions.some(
      (allowed) =>
        allowed.action === transition.action &&
        allowed.actorKind === transition.actorKind &&
        allowed.fromStatus === transition.fromStatus &&
        allowed.toStatus === transition.toStatus,
    );
    if (!isAllowed) {
      context.addIssue({
        code: "custom",
        message: "invalid dispute transition",
      });
    }
  });

export type DisputeStatus = z.infer<typeof disputeStatusContract>;
export type DisputeTransition = z.infer<typeof disputeTransitionContract>;
export type DisputeId = z.infer<typeof disputeIdContract>;
export type ViolationCaseId = z.infer<typeof violationCaseIdContract>;
export type DisputeEvidenceInput = z.infer<typeof disputeEvidenceInputContract>;
