import { randomUUID } from "node:crypto";

import {
  identityIdContract,
  orderIdContract,
  storeIdContract,
} from "@sevo/contracts/platform/v1";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresProblemFollowUpRepository } from "../../apps/api/src/modules/problem-follow-up/composition";
import type { PlatformSensitiveAction } from "../../apps/api/src/modules/identity-access/public";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 2 });
const buyerId = identityIdContract.parse(randomUUID());
const sellerId = identityIdContract.parse(randomUUID());
const agentId = identityIdContract.parse(randomUUID());
const orderId = orderIdContract.parse(randomUUID());
const storeId = storeIdContract.parse(randomUUID());
const grantId = randomUUID();
const correlationId = randomUUID();
const evidenceId = randomUUID();
const authorized: PlatformSensitiveAction[] = [];
const repository = new PostgresProblemFollowUpRepository(
  apiTestEnvironment.DATABASE_URL,
  {
    async authorizeSensitiveAction(_transaction, input) {
      authorized.push(input);
      return {
        grantId: input.grantId as never,
        scope: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          allowedActions: [input.action],
        },
        accessedAt: "2026-08-30T10:00:00.000Z",
        expiresAt: "2026-08-30T10:30:00.000Z",
      };
    },
  },
  () => ({ kind: "opaque-platform-access-transaction" }),
);

beforeEach(() => {
  authorized.length = 0;
});

afterAll(async () => {
  await repository.onModuleDestroy();
  await sql.end();
});

describe("problem follow-up producer persistence", () => {
  it("audits the legal dispute lifecycle, creates a separate violation and keeps sensitive evidence out of audit and outbox", async () => {
    const openedAt = new Date("2026-08-30T09:00:00.000Z");
    const openCommand = {
      actorId: buyerId,
      storeId,
      input: {
        orderId,
        category: "DAMAGED",
        description: "کالا هنگام تحویل آسیب‌دیده بود.",
        evidence: [{ evidenceId: evidenceId as never, kind: "IMAGE" }],
      },
      openedAt,
      sellerResponseDeadline: new Date("2026-09-01T09:00:00.000Z"),
      idempotencyKey: "open-dispute-140",
      requestHash: "a".repeat(64),
      correlationId,
    } as const;
    const opened = await repository.open(openCommand);
    await expect(repository.open(openCommand)).resolves.toEqual(opened);
    await expect(
      repository.replayOpen({
        actorId: buyerId,
        idempotencyKey: openCommand.idempotencyKey,
        requestHash: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await repository.readBuyer(buyerId, opened.disputeId)).toEqual(opened);
    await expect(repository.readBuyer(agentId, opened.disputeId)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );

    const sellerView = await repository.respond({
      disputeId: opened.disputeId,
      actorId: sellerId,
      storeId,
      input: {
        response: "پاسخ فروشگاه همراه با مدرک ارسال ثبت شد.",
        evidence: [],
      },
      occurredAt: new Date("2026-08-30T10:00:00.000Z"),
      idempotencyKey: "respond-dispute-140",
      requestHash: "b".repeat(64),
      correlationId,
    });
    expect(sellerView.status).toBe("UNDER_REVIEW");

    const resolved = await repository.resolve({
      disputeId: opened.disputeId,
      actorId: agentId,
      input: {
        status: "RESOLVED",
        outcomeCode: "VIOLATION_RECORDED",
        explanation: "تخلف فروشگاه ثبت شد؛ پیگیری بازپرداخت تضمین نمی‌شود.",
        evidence: [{ evidenceId: evidenceId as never, kind: "DOCUMENT" }],
        violationType: "PLATFORM_POLICY_BREACH",
      },
      occurredAt: new Date("2026-08-30T11:00:00.000Z"),
      idempotencyKey: "resolve-dispute-140",
      requestHash: "c".repeat(64),
      correlationId,
      access: { grantId, reason: "بررسی مدارک برای تصمیم همین پرونده" },
      responsibility: "DISPUTE_REVIEW",
      action: "UPDATE_CASE_STATUS",
    });
    expect(resolved).toMatchObject({
      status: "RESOLVED",
      outcome: { code: "VIOLATION_RECORDED" },
      access: { grantId, mode: "REVEALED_MINIMUM" },
    });

    const [violation] = await sql<Array<{ id: string }>>`
      select id from problem_violation_cases where source_reference_id = ${opened.disputeId}
    `;
    expect(violation).toBeDefined();
    const violationView = await repository.readPlatformViolation({
      caseId: violation!.id,
      actorId: agentId,
      responsibility: "VIOLATION_REVIEW",
      resourceType: "VIOLATION_CASE",
      action: "REVEAL_MINIMUM",
      access: { grantId, reason: "بررسی مدارک پرونده تخلف ثبت‌شده" },
      correlationId,
    });
    expect(violationView).toMatchObject({
      source: { kind: "DISPUTE", disputeId: opened.disputeId },
      status: "OPEN",
      actionReasonCodes: ["VIOLATION_RECORDED"],
    });

    await expect(
      repository.reopen({
        disputeId: opened.disputeId,
        actorId: agentId,
        input: {
          reason: "مدرک تازه پس از پایان مهلت دریافت شد.",
          evidence: [{ evidenceId: randomUUID() as never, kind: "DOCUMENT" }],
        },
        occurredAt: new Date("2026-09-07T11:00:00.001Z"),
        idempotencyKey: "late-reopen-140",
        requestHash: "d".repeat(64),
        correlationId,
        access: { grantId, reason: "بررسی مدرک تازه همین پرونده اختلاف" },
        responsibility: "DISPUTE_REVIEW",
        action: "UPDATE_CASE_STATUS",
      }),
    ).rejects.toMatchObject({ code: "DEADLINE_PASSED" });

    const reopened = await repository.reopen({
      disputeId: opened.disputeId,
      actorId: agentId,
      input: {
        reason: "مدرک تازه‌ای پس از اعلام نتیجه دریافت شد.",
        evidence: [{ evidenceId: randomUUID() as never, kind: "MESSAGE_REFERENCE" }],
      },
      occurredAt: new Date("2026-09-06T11:00:00.000Z"),
      idempotencyKey: "reopen-dispute-140",
      requestHash: "e".repeat(64),
      correlationId,
      access: { grantId, reason: "بررسی مدرک تازه همین پرونده اختلاف" },
      responsibility: "DISPUTE_REVIEW",
      action: "UPDATE_CASE_STATUS",
    });
    expect(reopened.status).toBe("UNDER_REVIEW");

    const audits = await sql<Array<{ action: string; evidenceCount: number }>>`
      select action, evidence_count as "evidenceCount"
      from problem_dispute_audits where dispute_id = ${opened.disputeId}
      order by occurred_at
    `;
    expect(audits).toEqual([
      { action: "OPEN", evidenceCount: 1 },
      { action: "RESPOND", evidenceCount: 0 },
      { action: "RESOLVE", evidenceCount: 1 },
      { action: "REOPEN", evidenceCount: 1 },
    ]);
    const events = await sql<Array<{ payload: Record<string, unknown> }>>`
      select payload from platform_outbox_events where correlation_id = ${correlationId}
    `;
    expect(events).toHaveLength(5);
    for (const event of events) {
      expect(JSON.stringify(event.payload)).not.toContain(evidenceId);
      expect(event.payload).not.toHaveProperty("description");
      expect(event.payload).not.toHaveProperty("explanation");
    }
    expect(authorized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          responsibility: "DISPUTE_REVIEW",
          resourceId: opened.disputeId,
          action: "UPDATE_CASE_STATUS",
        }),
        expect.objectContaining({
          responsibility: "VIOLATION_REVIEW",
          resourceId: violation!.id,
          action: "REVEAL_MINIMUM",
        }),
      ]),
    );

    await expect(
      sql`update problem_dispute_audits set reason_code = 'BUYER_OPENED_CASE' where dispute_id = ${opened.disputeId}`,
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      sql`delete from problem_dispute_audits where dispute_id = ${opened.disputeId}`,
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      sql`update problem_violation_audits set reason_code = 'VIOLATION_RECORDED' where violation_case_id = ${violation!.id}`,
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      sql`delete from problem_violation_audits where violation_case_id = ${violation!.id}`,
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("hands an unanswered expired case to platform review and allows a recorded resolution", async () => {
    const expiredOrderId = orderIdContract.parse(randomUUID());
    const expiredCorrelationId = randomUUID();
    const opened = await repository.open({
      actorId: buyerId,
      storeId,
      input: {
        orderId: expiredOrderId,
        category: "DELIVERY_NOT_RECEIVED",
        description: "فروشنده در مهلت تعیین‌شده پاسخی ثبت نکرده است.",
        evidence: [{ evidenceId: randomUUID() as never, kind: "MESSAGE_REFERENCE" }],
      },
      openedAt: new Date("2026-08-20T09:00:00.000Z"),
      sellerResponseDeadline: new Date("2026-08-22T09:00:00.000Z"),
      idempotencyKey: `expired-open-${randomUUID()}`,
      requestHash: "1".repeat(64),
      correlationId: expiredCorrelationId,
    });

    const queue = await repository.listPlatformDisputes({ limit: 100 });
    expect(
      queue.items.find((item) => item.disputeId === opened.disputeId)?.nextAction,
    ).toEqual({ actorKind: "PLATFORM_AGENT", code: "REVIEW_CASE" });
    await expect(
      repository.resolve({
        disputeId: opened.disputeId,
        actorId: agentId,
        input: {
          status: "CLOSED",
          outcomeCode: "INSUFFICIENT_EVIDENCE",
          explanation: "مهلت پاسخ گذشته و مدرک کافی برای اقدام بیشتر وجود ندارد.",
          evidence: [],
        },
        occurredAt: new Date("2026-08-23T09:00:00.000Z"),
        idempotencyKey: `expired-resolve-${randomUUID()}`,
        requestHash: "2".repeat(64),
        correlationId: expiredCorrelationId,
        access: { grantId, reason: "بررسی پرونده بی‌پاسخ پس از پایان مهلت" },
        responsibility: "DISPUTE_REVIEW",
        action: "UPDATE_CASE_STATUS",
      }),
    ).resolves.toMatchObject({ status: "CLOSED" });
  });
});
