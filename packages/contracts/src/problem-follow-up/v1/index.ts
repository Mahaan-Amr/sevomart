import { z } from "zod";

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
  .strict();

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

const disputeStatusChangedPayloadContract = z
  .object({
    disputeId: disputeIdContract,
    fromStatus: disputeStatusContract,
    toStatus: disputeStatusContract,
    nextDeadlineAt: timestampV1Contract.nullable(),
    reasonCode: disputeAuditReasonCodeContract,
  })
  .strict();

export const disputeRespondedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DisputeResponded.v1"),
  payload: disputeStatusChangedPayloadContract,
});
export const disputeResolvedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DisputeResolved.v1"),
  payload: disputeStatusChangedPayloadContract,
});
export const disputeReopenedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DisputeReopened.v1"),
  payload: disputeStatusChangedPayloadContract,
});

export const violationCaseIdContract = z.uuid().brand<"ViolationCaseId">();
export const violationCaseStatusContract = z.enum([
  "OPEN",
  "UNDER_REVIEW",
  "ACTION_REQUIRED",
  "RESOLVED",
  "CLOSED",
]);
export const violationCaseTransitionActionContract = z.enum([
  "OPEN",
  "START_REVIEW",
  "REQUIRE_ACTION",
  "RESOLVE",
  "CLOSE",
  "REOPEN",
]);
const allowedViolationTransitions = new Set([
  "OPEN:null:OPEN",
  "START_REVIEW:OPEN:UNDER_REVIEW",
  "REQUIRE_ACTION:UNDER_REVIEW:ACTION_REQUIRED",
  "START_REVIEW:ACTION_REQUIRED:UNDER_REVIEW",
  "RESOLVE:UNDER_REVIEW:RESOLVED",
  "CLOSE:UNDER_REVIEW:CLOSED",
  "REOPEN:RESOLVED:UNDER_REVIEW",
  "REOPEN:CLOSED:UNDER_REVIEW",
]);
export const violationCaseTransitionContract = z
  .object({
    action: violationCaseTransitionActionContract,
    actorIdentityId: identityIdContract,
    fromStatus: violationCaseStatusContract.nullable(),
    toStatus: violationCaseStatusContract,
  })
  .strict()
  .superRefine((transition, context) => {
    const signature = [
      transition.action,
      transition.fromStatus ?? "null",
      transition.toStatus,
    ].join(":");
    if (!allowedViolationTransitions.has(signature)) {
      context.addIssue({ code: "custom", message: "invalid violation transition" });
    }
  });

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

export const openDisputeInputContract = z
  .object({
    orderId: orderIdContract,
    category: disputeCategoryContract,
    description: z.string().trim().min(10).max(2_000),
    evidenceIds: z.array(disputeEvidenceIdContract).min(1).max(10),
  })
  .strict();
export const respondToDisputeInputContract = z
  .object({
    response: z.string().trim().min(10).max(2_000),
    evidenceIds: z.array(disputeEvidenceIdContract).max(10),
  })
  .strict();
export const resolveDisputeInputContract = z
  .object({
    status: z.enum(["RESOLVED", "CLOSED"]),
    outcomeCode: disputeOutcomeCodeContract,
    explanation: z.string().trim().min(10).max(2_000),
    evidenceIds: z.array(disputeEvidenceIdContract).max(10),
  })
  .strict();
export const reopenDisputeInputContract = z
  .object({
    reason: z.string().trim().min(10).max(2_000),
    evidenceIds: z.array(disputeEvidenceIdContract).min(1).max(10),
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
export const platformDisputeViewContract = relatedPartyDisputeViewContract.extend({
  access: z
    .object({
      mode: z.literal("REVEALED_MINIMUM"),
      expiresAt: timestampV1Contract,
    })
    .strict(),
});

export const violationTypeContract = z.enum([
  "FULFILLMENT_NONCOMPLIANCE",
  "MISREPRESENTATION",
  "REFUND_NONCOMPLIANCE",
  "REPEATED_DISPUTES",
  "PLATFORM_POLICY_BREACH",
]);
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
    actionReasonCodes: z.array(z.string().min(1).max(100)).max(50),
    access: z
      .object({
        mode: z.literal("REVEALED_MINIMUM"),
        expiresAt: timestampV1Contract,
      })
      .strict(),
  })
  .strict();

const violationCaseOpenedPayloadContract = z
  .object({
    violationCaseId: violationCaseIdContract,
    type: violationTypeContract,
    source: violationSourceContract,
    status: z.literal("OPEN"),
    deadlineAt: timestampV1Contract.nullable(),
  })
  .strict();
export const violationCaseOpenedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("ViolationCaseOpened.v1"),
  payload: violationCaseOpenedPayloadContract,
});
export const violationCaseStatusChangedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("ViolationCaseStatusChanged.v1"),
  payload: z
    .object({
      violationCaseId: violationCaseIdContract,
      fromStatus: violationCaseStatusContract,
      toStatus: violationCaseStatusContract,
      reasonCode: z.string().min(1).max(100),
      nextDeadlineAt: timestampV1Contract.nullable(),
    })
    .strict(),
});
export const violationCaseAuditEntryContract = z
  .object({
    auditId: z.uuid().brand<"ViolationCaseAuditId">(),
    violationCaseId: violationCaseIdContract,
    actorIdentityId: identityIdContract,
    action: violationCaseTransitionActionContract,
    fromStatus: violationCaseStatusContract.nullable(),
    toStatus: violationCaseStatusContract,
    reasonCode: z.string().min(1).max(100),
    evidenceCount: z.int().nonnegative().max(20),
    occurredAt: timestampV1Contract,
    correlationId: z.uuid(),
  })
  .strict();

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
  ViolationCaseOpenedV1: violationCaseOpenedV1Contract,
  ViolationCaseStatusChangedV1: violationCaseStatusChangedV1Contract,
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
  DisputeStatus: "AWAITING_SELLER_RESPONSE",
  ViolationCaseStatus: "OPEN",
  OpenDisputeInput: {
    orderId: exampleDispute.orderId,
    category: "DAMAGED",
    description: "کالا هنگام تحویل آسیب‌دیده بود.",
    evidenceIds: [exampleDispute.contributions[0].evidence[0].evidenceId],
  },
  RespondToDisputeInput: {
    response: "پاسخ فروشگاه همراه با مدرک ارسال ثبت شد.",
    evidenceIds: [],
  },
  ResolveDisputeInput: {
    status: "RESOLVED",
    outcomeCode: "SELLER_ACTION_AGREED",
    explanation: "فروشگاه اقدام توافق‌شده را ثبت کرده است.",
    evidenceIds: [],
  },
  ReopenDisputeInput: {
    reason: "مدرک تازه‌ای پس از اعلام نتیجه دریافت شد.",
    evidenceIds: [exampleDispute.contributions[0].evidence[0].evidenceId],
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
      mode: "REVEALED_MINIMUM",
      expiresAt: "2026-08-27T09:00:00.000Z",
    },
  },
  PlatformViolationQueue: { items: [exampleViolation], nextCursor: null },
  PlatformViolationCaseView: {
    ...exampleViolation,
    evidence: [],
    actionReasonCodes: [],
    access: {
      mode: "REVEALED_MINIMUM",
      expiresAt: "2026-08-27T09:30:00.000Z",
    },
  },
  ProblemFollowUpError: {
    code: "INVALID_TRANSITION",
    message: "این تغییر با وضعیت فعلی پرونده سازگار نیست.",
    correlationId: "request-correlation-01",
  },
} as const;

const allowedDisputeTransitions = new Set([
  "OPEN:BUYER:null:AWAITING_SELLER_RESPONSE",
  "RESPOND:SELLER:AWAITING_SELLER_RESPONSE:UNDER_REVIEW",
  "RESOLVE:PLATFORM_AGENT:UNDER_REVIEW:RESOLVED",
  "RESOLVE:PLATFORM_AGENT:UNDER_REVIEW:CLOSED",
  "REOPEN:PLATFORM_AGENT:RESOLVED:UNDER_REVIEW",
  "REOPEN:PLATFORM_AGENT:CLOSED:UNDER_REVIEW",
]);

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
    const signature = [
      transition.action,
      transition.actorKind,
      transition.fromStatus ?? "null",
      transition.toStatus,
    ].join(":");
    if (!allowedDisputeTransitions.has(signature)) {
      context.addIssue({
        code: "custom",
        message: "invalid dispute transition",
      });
    }
  });

export type DisputeStatus = z.infer<typeof disputeStatusContract>;
export type DisputeTransition = z.infer<typeof disputeTransitionContract>;
