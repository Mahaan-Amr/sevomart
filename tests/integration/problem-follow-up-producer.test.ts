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
const buyerId = identityIdContract.parse("10000000-0000-4000-8000-000000000140");
const sellerId = identityIdContract.parse("20000000-0000-4000-8000-000000000140");
const agentId = identityIdContract.parse("30000000-0000-4000-8000-000000000140");
const orderId = orderIdContract.parse("40000000-0000-4000-8000-000000000140");
const storeId = storeIdContract.parse("50000000-0000-4000-8000-000000000140");
const grantId = "60000000-0000-4000-8000-000000000140";
const correlationId = "70000000-0000-4000-8000-000000000140";
const evidenceId = "80000000-0000-4000-8000-000000000140";
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

beforeEach(async () => {
  authorized.length = 0;
  await sql`delete from platform_outbox_events where correlation_id = ${correlationId}`;
  await sql`delete from problem_follow_up_idempotency_records where actor_id in (${buyerId}, ${sellerId}, ${agentId})`;
  await sql`delete from problem_violation_audits where actor_identity_id = ${agentId}`;
  await sql`delete from problem_violation_cases where source_reference_id in (select id from problem_disputes where order_id = ${orderId})`;
  await sql`delete from problem_dispute_audits where actor_identity_id in (${buyerId}, ${sellerId}, ${agentId})`;
  await sql`delete from problem_disputes where order_id = ${orderId}`;
});

afterAll(async () => {
  await repository.onModuleDestroy();
  await sql.end();
});

describe("problem follow-up producer persistence", () => {
  it("audits the legal dispute lifecycle, creates a separate violation and keeps sensitive evidence out of audit and outbox", async () => {
    const openedAt = new Date("2026-08-30T09:00:00.000Z");
    const opened = await repository.open({
      actorId: buyerId,
      storeId,
      input: {
        orderId,
        category: "DAMAGED",
        description: "کالا هنگام تحویل آسیب‌دیده بود.",
        evidenceIds: [evidenceId as never],
      },
      openedAt,
      sellerResponseDeadline: new Date("2026-09-01T09:00:00.000Z"),
      idempotencyKey: "open-dispute-140",
      requestHash: "a".repeat(64),
      correlationId,
    });
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
        evidenceIds: [],
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
        evidenceIds: [evidenceId as never],
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
          evidenceIds: [randomUUID() as never],
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
        evidenceIds: [randomUUID() as never],
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
  });
});
