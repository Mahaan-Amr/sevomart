import {
  DISPUTE_DELIVERED_OPEN_WINDOW_DAYS,
  DISPUTE_REOPEN_WINDOW_DAYS,
  DISPUTE_SELLER_FIRST_RESPONSE_HOURS,
  DISPUTE_SHIPPED_OPEN_WINDOW_DAYS,
  buyerDisputeViewContract,
  disputeAuditEntryContract,
  disputeOpenedV1Contract,
  disputeReopenedV1Contract,
  disputeResolvedV1Contract,
  disputeRespondedV1Contract,
  disputeTransitionContract,
  openDisputeCommandContract,
  openDisputeInputContract,
  platformDisputeQueueItemContract,
  platformDisputeViewContract,
  resolveDisputeInputContract,
  sellerDisputeViewContract,
  violationCaseAuditEntryContract,
  violationRecordedV1Contract,
} from "@sevo/contracts/problem-follow-up/v1";
import { describe, expect, it } from "vitest";

const buyerId = "00000000-0000-4000-8000-000000000001";
const sellerId = "00000000-0000-4000-8000-000000000002";
const agentId = "00000000-0000-4000-8000-000000000003";
const disputeId = "00000000-0000-4000-8000-000000000004";
const orderId = "00000000-0000-4000-8000-000000000005";
const storeId = "00000000-0000-4000-8000-000000000006";
const evidenceId = "00000000-0000-4000-8000-000000000007";

describe("problem follow-up v1 transitions", () => {
  it("publishes the decided dispute windows and accepts only the four legal transitions", () => {
    expect({
      delivered: DISPUTE_DELIVERED_OPEN_WINDOW_DAYS,
      shipped: DISPUTE_SHIPPED_OPEN_WINDOW_DAYS,
      sellerResponse: DISPUTE_SELLER_FIRST_RESPONSE_HOURS,
      reopen: DISPUTE_REOPEN_WINDOW_DAYS,
    }).toEqual({ delivered: 7, shipped: 14, sellerResponse: 48, reopen: 7 });

    const legalTransitions = [
      {
        action: "OPEN",
        actorKind: "BUYER",
        actorIdentityId: buyerId,
        fromStatus: null,
        toStatus: "AWAITING_SELLER_RESPONSE",
      },
      {
        action: "RESPOND",
        actorKind: "SELLER",
        actorIdentityId: sellerId,
        fromStatus: "AWAITING_SELLER_RESPONSE",
        toStatus: "UNDER_REVIEW",
      },
      {
        action: "RESOLVE",
        actorKind: "PLATFORM_AGENT",
        actorIdentityId: agentId,
        fromStatus: "AWAITING_SELLER_RESPONSE",
        toStatus: "RESOLVED",
      },
      {
        action: "RESOLVE",
        actorKind: "PLATFORM_AGENT",
        actorIdentityId: agentId,
        fromStatus: "AWAITING_SELLER_RESPONSE",
        toStatus: "CLOSED",
      },
      {
        action: "RESOLVE",
        actorKind: "PLATFORM_AGENT",
        actorIdentityId: agentId,
        fromStatus: "UNDER_REVIEW",
        toStatus: "RESOLVED",
      },
      {
        action: "RESOLVE",
        actorKind: "PLATFORM_AGENT",
        actorIdentityId: agentId,
        fromStatus: "UNDER_REVIEW",
        toStatus: "CLOSED",
      },
      {
        action: "REOPEN",
        actorKind: "PLATFORM_AGENT",
        actorIdentityId: agentId,
        fromStatus: "RESOLVED",
        toStatus: "UNDER_REVIEW",
      },
      {
        action: "REOPEN",
        actorKind: "PLATFORM_AGENT",
        actorIdentityId: agentId,
        fromStatus: "CLOSED",
        toStatus: "UNDER_REVIEW",
      },
    ] as const;

    for (const transition of legalTransitions) {
      expect(disputeTransitionContract.parse(transition)).toEqual(transition);
    }

    expect(() =>
      disputeTransitionContract.parse({
        ...legalTransitions[1],
        actorKind: "BUYER",
        actorIdentityId: buyerId,
      }),
    ).toThrow();
    expect(() =>
      disputeTransitionContract.parse({
        ...legalTransitions[5],
        fromStatus: "SUBMITTED",
      }),
    ).toThrow();
  });

  it("keeps the declared evidence kind and requires an explicit recorded-violation type", () => {
    expect(
      openDisputeInputContract.parse({
        orderId,
        category: "DAMAGED",
        description: "کالا هنگام تحویل آسیب‌دیده بود.",
        evidence: [{ evidenceId, kind: "DOCUMENT" }],
      }).evidence[0]?.kind,
    ).toBe("DOCUMENT");
    expect(() =>
      resolveDisputeInputContract.parse({
        status: "RESOLVED",
        outcomeCode: "VIOLATION_RECORDED",
        explanation: "تخلف ثبت‌شده به پیگیری جدا نیاز دارد.",
        evidence: [],
      }),
    ).toThrow();
    expect(() =>
      resolveDisputeInputContract.parse({
        status: "RESOLVED",
        outcomeCode: "POLICY_EXPLAINED",
        explanation: "سیاست ثبت‌شده برای دو طرف توضیح داده شد.",
        evidence: [],
        violationType: "MISREPRESENTATION",
      }),
    ).toThrow();
  });
});

describe("problem follow-up v1 least-data views", () => {
  const visibleCase = {
    disputeId,
    orderId,
    storeId,
    status: "AWAITING_SELLER_RESPONSE",
    category: "DAMAGED",
    openedAt: "2026-08-27T12:00:00+03:30",
    deadline: {
      kind: "SELLER_FIRST_RESPONSE",
      dueAt: "2026-08-29T12:00:00+03:30",
    },
    nextAction: { actorKind: "SELLER", code: "SUBMIT_FIRST_RESPONSE" },
    contributions: [
      {
        authorKind: "BUYER",
        text: "کالا هنگام تحویل آسیب‌دیده بود.",
        evidence: [
          {
            evidenceId,
            kind: "IMAGE",
            submittedAt: "2026-08-27T12:00:00+03:30",
          },
        ],
        submittedAt: "2026-08-27T12:00:00+03:30",
      },
    ],
    outcome: null,
  } as const;

  it("keeps buyer and seller case views scoped to the related order", () => {
    expect(buyerDisputeViewContract.parse(visibleCase)).toEqual(visibleCase);
    expect(sellerDisputeViewContract.parse(visibleCase)).toEqual(visibleCase);

    for (const contract of [buyerDisputeViewContract, sellerDisputeViewContract]) {
      expect(() =>
        contract.parse({
          ...visibleCase,
          buyerMobile: "09120000000",
          deliveryAddress: "تهران، نشانی کامل خریدار",
        }),
      ).toThrow();
    }
  });

  it("keeps the platform queue low-detail and excludes descriptions and evidence", () => {
    const queueItem = {
      disputeId,
      status: "AWAITING_SELLER_RESPONSE",
      category: "DAMAGED",
      openedAt: "2026-08-27T12:00:00+03:30",
      deadline: visibleCase.deadline,
      nextAction: visibleCase.nextAction,
    } as const;
    expect(platformDisputeQueueItemContract.parse(queueItem)).toEqual(queueItem);
    expect(() =>
      platformDisputeQueueItemContract.parse({
        ...queueItem,
        description: visibleCase.contributions[0].text,
        evidence: visibleCase.contributions[0].evidence,
      }),
    ).toThrow();
  });

  it("reveals platform details only for a live scope bound to the same case", () => {
    const platformView = {
      ...visibleCase,
      access: {
        grantId: "00000000-0000-4000-8000-000000000013",
        mode: "REVEALED_MINIMUM",
        scope: {
          resourceType: "DISPUTE_CASE",
          resourceId: disputeId,
          allowedActions: ["REVEAL_MINIMUM"],
        },
        accessedAt: "2026-08-27T12:00:00+03:30",
        expiresAt: "2026-08-27T12:30:00+03:30",
      },
    } as const;
    expect(platformDisputeViewContract.parse(platformView)).toEqual(platformView);
    expect(() =>
      platformDisputeViewContract.parse({
        ...platformView,
        access: {
          ...platformView.access,
          scope: {
            ...platformView.access.scope,
            resourceId: orderId,
          },
        },
      }),
    ).toThrow();
    expect(() =>
      platformDisputeViewContract.parse({
        ...platformView,
        access: {
          ...platformView.access,
          expiresAt: platformView.access.accessedAt,
        },
      }),
    ).toThrow();
  });
});

describe("problem follow-up v1 audit and events", () => {
  const event = {
    version: 1,
    eventId: "00000000-0000-4000-8000-000000000008",
    eventType: "DisputeOpened.v1",
    aggregateId: disputeId,
    aggregateVersion: 1,
    occurredAt: "2026-08-27T12:00:00+03:30",
    correlationId: "00000000-0000-4000-8000-000000000009",
    actor: { type: "IDENTITY", id: buyerId },
    payload: {
      disputeId,
      orderId,
      storeId,
      category: "DAMAGED",
      status: "AWAITING_SELLER_RESPONSE",
      deadlineAt: "2026-08-29T12:00:00+03:30",
    },
  } as const;

  it("keeps sensitive evidence and narrative out of events and audit records", () => {
    expect(disputeOpenedV1Contract.parse(event)).toEqual(event);
    expect(() =>
      disputeOpenedV1Contract.parse({
        ...event,
        payload: {
          ...event.payload,
          description: "شرح خصوصی خریدار",
          evidence: [evidenceId],
        },
      }),
    ).toThrow();

    const audit = {
      auditId: "00000000-0000-4000-8000-000000000010",
      disputeId,
      action: "OPEN",
      actorKind: "BUYER",
      actorIdentityId: buyerId,
      fromStatus: null,
      toStatus: "AWAITING_SELLER_RESPONSE",
      reasonCode: "BUYER_OPENED_CASE",
      evidenceCount: 1,
      occurredAt: "2026-08-27T12:00:00+03:30",
      correlationId: "00000000-0000-4000-8000-000000000009",
    } as const;
    expect(disputeAuditEntryContract.parse(audit)).toEqual(audit);
    expect(() =>
      disputeAuditEntryContract.parse({
        ...audit,
        evidence: [evidenceId],
        description: "شرح خصوصی خریدار",
      }),
    ).toThrow();

    expect(() =>
      disputeAuditEntryContract.parse({
        ...audit,
        reasonCode: "NEW_EVIDENCE_RECEIVED",
      }),
    ).toThrow();
  });

  it("binds each event name to its legal state transition", () => {
    const envelope = {
      version: 1,
      eventId: "00000000-0000-4000-8000-000000000014",
      aggregateId: disputeId,
      aggregateVersion: 2,
      occurredAt: "2026-08-27T12:10:00+03:30",
      correlationId: "00000000-0000-4000-8000-000000000009",
      actor: { type: "IDENTITY", id: agentId },
    } as const;
    expect(
      disputeRespondedV1Contract.parse({
        ...envelope,
        eventType: "DisputeResponded.v1",
        payload: {
          disputeId,
          fromStatus: "AWAITING_SELLER_RESPONSE",
          toStatus: "UNDER_REVIEW",
          nextDeadlineAt: null,
          reasonCode: "SELLER_SUBMITTED_RESPONSE",
        },
      }).payload.toStatus,
    ).toBe("UNDER_REVIEW");
    expect(
      disputeResolvedV1Contract.parse({
        ...envelope,
        eventType: "DisputeResolved.v1",
        payload: {
          disputeId,
          fromStatus: "UNDER_REVIEW",
          toStatus: "CLOSED",
          nextDeadlineAt: "2026-09-03T12:10:00+03:30",
          reasonCode: "PLATFORM_CLOSED_CASE",
        },
      }).payload.toStatus,
    ).toBe("CLOSED");
    expect(
      disputeReopenedV1Contract.parse({
        ...envelope,
        eventType: "DisputeReopened.v1",
        payload: {
          disputeId,
          fromStatus: "RESOLVED",
          toStatus: "UNDER_REVIEW",
          nextDeadlineAt: null,
          reasonCode: "NEW_EVIDENCE_RECEIVED",
        },
      }).payload.toStatus,
    ).toBe("UNDER_REVIEW");
    expect(() =>
      disputeRespondedV1Contract.parse({
        ...envelope,
        eventType: "DisputeResponded.v1",
        payload: {
          disputeId,
          fromStatus: "RESOLVED",
          toStatus: "DRAFT",
          nextDeadlineAt: null,
          reasonCode: "SELLER_SUBMITTED_RESPONSE",
        },
      }),
    ).toThrow();
  });

  it("derives the actor from the authenticated command context", () => {
    const command = {
      actorKind: "BUYER",
      actorIdentityId: buyerId,
      occurredAt: "2026-08-27T12:00:00+03:30",
      correlationId: "00000000-0000-4000-8000-000000000009",
      idempotencyKey: "open-dispute-01",
      orderId,
      category: "DAMAGED",
      description: "کالا هنگام تحویل آسیب‌دیده بود.",
      evidence: [{ evidenceId, kind: "IMAGE" }],
    } as const;
    expect(openDisputeCommandContract.parse(command)).toEqual(command);
    expect(() =>
      openDisputeCommandContract.parse({ ...command, actorKind: "SELLER" }),
    ).toThrow();
  });

  it("records violation follow-up independently without inventing an order transition", () => {
    const violationEvent = {
      version: 1,
      eventId: "00000000-0000-4000-8000-000000000011",
      eventType: "ViolationRecorded.v1",
      aggregateId: "00000000-0000-4000-8000-000000000012",
      aggregateVersion: 1,
      occurredAt: "2026-08-27T12:00:00+03:30",
      correlationId: "00000000-0000-4000-8000-000000000009",
      actor: { type: "IDENTITY", id: agentId },
      payload: {
        violationCaseId: "00000000-0000-4000-8000-000000000012",
        type: "FULFILLMENT_NONCOMPLIANCE",
        source: { kind: "DISPUTE", disputeId },
        status: "OPEN",
        deadlineAt: null,
      },
    } as const;
    expect(violationRecordedV1Contract.parse(violationEvent)).toEqual(violationEvent);
    expect(() =>
      violationRecordedV1Contract.parse({
        ...violationEvent,
        payload: {
          ...violationEvent.payload,
          orderStatus: "CANCELED",
          disputeStatus: "RESOLVED",
          evidence: [evidenceId],
        },
      }),
    ).toThrow();

    const violationAudit = {
      auditId: "00000000-0000-4000-8000-000000000015",
      violationCaseId: violationEvent.payload.violationCaseId,
      actorIdentityId: agentId,
      action: "RECORD_VIOLATION",
      status: "OPEN",
      reasonCode: "VIOLATION_RECORDED",
      evidenceCount: 1,
      occurredAt: "2026-08-27T12:00:00+03:30",
      correlationId: "00000000-0000-4000-8000-000000000009",
    } as const;
    expect(violationCaseAuditEntryContract.parse(violationAudit)).toEqual(
      violationAudit,
    );
    expect(() =>
      violationCaseAuditEntryContract.parse({
        ...violationAudit,
        reasonCode: "شماره خریدار 09120000000 است",
      }),
    ).toThrow();
  });
});
