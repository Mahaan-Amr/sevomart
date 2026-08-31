import {
  disputeAuditEntryV2Contract,
  openDisputeCommandV2Contract,
  openDisputeInputV2Contract,
  resolveDisputeInputV2Contract,
} from "@sevo/contracts/problem-follow-up/v2";
import { describe, expect, it } from "vitest";

const buyerId = "00000000-0000-4000-8000-000000000001";
const orderId = "00000000-0000-4000-8000-000000000005";
const evidenceId = "00000000-0000-4000-8000-000000000007";

describe("problem follow-up v2 mutations", () => {
  it("versions the expired-seller escalation audit without weakening v1", () => {
    const audit = {
      auditId: "00000000-0000-4000-8000-000000000010",
      disputeId: "00000000-0000-4000-8000-000000000011",
      action: "ESCALATE",
      actorKind: "PLATFORM_AGENT",
      actorIdentityId: "00000000-0000-4000-8000-000000000012",
      fromStatus: "AWAITING_SELLER_RESPONSE",
      toStatus: "UNDER_REVIEW",
      reasonCode: "SELLER_RESPONSE_DEADLINE_EXPIRED",
      evidenceCount: 0,
      occurredAt: "2026-08-31T09:00:00.000Z",
      correlationId: "00000000-0000-4000-8000-000000000013",
    } as const;

    expect(disputeAuditEntryV2Contract.parse(audit)).toEqual(audit);
    expect(() =>
      disputeAuditEntryV2Contract.parse({ ...audit, evidenceCount: 1 }),
    ).toThrow();
  });

  it("requires the caller to declare every evidence kind", () => {
    const input = {
      orderId,
      category: "DAMAGED",
      description: "کالا هنگام تحویل آسیب‌دیده بود.",
      evidence: [{ evidenceId, kind: "DOCUMENT" }],
    } as const;

    expect(openDisputeInputV2Contract.parse(input)).toEqual(input);
    expect(() =>
      openDisputeInputV2Contract.parse({
        ...input,
        evidence: [{ evidenceId }],
      }),
    ).toThrow();
    expect(() =>
      openDisputeInputV2Contract.parse({
        ...input,
        evidenceIds: [evidenceId],
      }),
    ).toThrow();
  });

  it("requires an explicit type only when a violation is recorded", () => {
    const violation = {
      status: "RESOLVED",
      outcomeCode: "VIOLATION_RECORDED",
      explanation: "تخلف ثبت‌شده به پیگیری جدا نیاز دارد.",
      evidence: [],
      violationType: "MISREPRESENTATION",
    } as const;

    expect(resolveDisputeInputV2Contract.parse(violation)).toEqual(violation);
    expect(() =>
      resolveDisputeInputV2Contract.parse({
        ...violation,
        violationType: undefined,
      }),
    ).toThrow();
    expect(() =>
      resolveDisputeInputV2Contract.parse({
        ...violation,
        outcomeCode: "POLICY_EXPLAINED",
      }),
    ).toThrow();
  });

  it("keeps actor identity outside the public input and typed in the command", () => {
    const command = {
      actorIdentityId: buyerId,
      actorKind: "BUYER",
      occurredAt: "2026-08-31T09:00:00.000Z",
      correlationId: "00000000-0000-4000-8000-000000000009",
      idempotencyKey: "open-v2-140",
      orderId,
      category: "DAMAGED",
      description: "کالا هنگام تحویل آسیب‌دیده بود.",
      evidence: [{ evidenceId, kind: "IMAGE" }],
    } as const;

    expect(openDisputeCommandV2Contract.parse(command)).toEqual(command);
    expect(() =>
      openDisputeInputV2Contract.parse({
        ...command,
      }),
    ).toThrow();
  });
});
