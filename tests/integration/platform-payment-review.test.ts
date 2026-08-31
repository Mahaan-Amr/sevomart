import { createHash, randomBytes, randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("platform payment review case access", () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 2 });
  const identityId = randomUUID();
  const sessionId = randomUUID();
  const permissionId = randomUUID();
  const reviewId = randomUUID();
  const orderId = randomUUID();
  const grantId = randomUUID();
  const sessionToken = randomBytes(32).toString("base64url");
  let app: Awaited<ReturnType<typeof createApiApp>> | undefined;

  beforeAll(async () => {
    app = await createApiApp(apiTestEnvironment);
    await sql.begin(async (transaction) => {
      await transaction`
        insert into identity_identities (id, status) values (${identityId}, 'ACTIVE')
      `;
      await transaction`
        insert into identity_sessions
          (id, token_hash, identity_id, audience, expires_at)
        values
          (${sessionId}, ${hash(sessionToken)}, ${identityId}, 'PLATFORM_AGENT',
           now() + interval '1 hour')
      `;
      await transaction`
        insert into identity_platform_permission_grants
          (id, identity_id, permission, granted_at)
        values (${permissionId}, ${identityId}, 'PAYMENT_REVIEW', now())
      `;
      await transaction`
        insert into payment_attempts
          (id, order_id, identity_id, status, amount, provider,
           provider_reference, reconciliation_count, next_reconciliation_at,
           review_started_at)
        values
          (${reviewId}, ${orderId}, ${identityId}, 'REVIEW_REQUIRED', 4500000,
           'DEV', 'provider-reference-151', 2, now() + interval '10 minutes', now())
      `;
      await transaction`
        insert into payment_attempt_audits
          (id, attempt_id, from_status, to_status, reason_code, actor_kind,
           correlation_id)
        values
          (${randomUUID()}, ${reviewId}, 'DISPATCHED', 'REVIEW_REQUIRED',
           'PROVIDER_RESULT_PENDING', 'PAYMENTS_SERVICE', ${randomUUID()})
      `;
      await transaction`
        insert into payment_provider_observations
          (provider, provider_event_id, attempt_id, provider_reference, result,
           correlation_id)
        values
          ('DEV', ${`provider-event-${reviewId}`}, ${reviewId},
           'provider-reference-151', 'PENDING', ${randomUUID()})
      `;
      await transaction`
        insert into identity_platform_access_grants
          (id, grant_kind, subject_identity_id, requested_by_identity_id,
           approved_by_identity_id, responsibility, purpose_code, scope, status,
           control_mode, single_manager_exception, revision, expires_at, created_at,
           activated_at)
        values
          (${grantId}, 'SENSITIVE_ACCESS', ${identityId}, ${identityId}, null,
           'PAYMENT_REVIEW', 'VERIFY_CASE_EVIDENCE',
           ${transaction.json({
             resourceType: "PAYMENT_REVIEW",
             resourceId: reviewId,
             allowedActions: ["REVEAL_MINIMUM", "UPDATE_CASE_STATUS"],
           })},
           'ACTIVE', 'SINGLE_MANAGER_EXCEPTION', true, 1,
           now() + interval '30 minutes', now(), now())
      `;
    });
  });

  afterAll(async () => {
    await app?.close();
    await sql`truncate identity_platform_access_audit`;
    await sql`delete from identity_platform_access_grants where id = ${grantId}`;
    await sql`delete from payment_provider_observations where attempt_id = ${reviewId}`;
    await sql`delete from payment_attempt_audits where attempt_id = ${reviewId}`;
    await sql`delete from payment_attempts where id = ${reviewId}`;
    await sql`delete from identity_platform_permission_grants where id = ${permissionId}`;
    await sql`delete from identity_sessions where id = ${sessionId}`;
    await sql`delete from identity_identities where id = ${identityId}`;
    await sql.end();
  });

  it("keeps the queue minimal, audits reveal, schedules recheck, and fails closed after revocation", async () => {
    const server = app!.getHttpAdapter().getInstance();
    const headers = { cookie: `sevo_platform_session=${sessionToken}` };

    const retiredQueue = await server.inject({
      method: "GET",
      url: "/v1/platform/payment-reviews",
      headers,
    });
    expect(retiredQueue.statusCode).toBe(404);

    const queue = await server.inject({
      method: "GET",
      url: "/v2/platform/payment-reviews",
      headers,
    });
    expect(queue.statusCode).toBe(200);
    const summary = queue
      .json<{ items: Array<Record<string, unknown>> }>()
      .items.find((item) => item.reviewId === reviewId);
    expect(summary).toMatchObject({ reviewId, reviewKind: "RESULT_AMBIGUOUS" });
    expect(summary).not.toHaveProperty("orderId");
    expect(summary).not.toHaveProperty("providerReference");
    expect(summary).not.toHaveProperty("audits");

    const revealed = await server.inject({
      method: "POST",
      url: `/v2/platform/payment-reviews/${reviewId}/reveal`,
      headers,
      payload: {
        grantId,
        reason: "بررسی مدرک درگاه برای پرونده پرداخت مشخص",
      },
    });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json()).toMatchObject({
      reviewId,
      orderId,
      providerReference: "provider-reference-151",
      observations: [{ result: "PENDING" }],
      audits: [{ reasonCode: "PROVIDER_RESULT_PENDING" }],
      accessExpiresAt: expect.any(String),
    });
    expect(
      await sql`
        select action, outcome, scope ->> 'resourceId' as "resourceId"
        from identity_platform_access_audit
        where grant_id = ${grantId} and action = 'SENSITIVE_FIELD_REVEALED'
      `,
    ).toEqual([
      {
        action: "SENSITIVE_FIELD_REVEALED",
        outcome: "SUCCEEDED",
        resourceId: reviewId,
      },
    ]);

    const before = new Date();
    const reconciliation = await server.inject({
      method: "POST",
      url: `/v2/platform/payment-reviews/${reviewId}/reconciliation`,
      headers,
      payload: { grantId, reason: "درخواست تطبیق دوباره نتیجه درگاه" },
    });
    expect(reconciliation.statusCode).toBe(202);
    expect(
      await sql<Array<{ nextReconciliationAt: Date }>>`
        select next_reconciliation_at as "nextReconciliationAt"
        from payment_attempts where id = ${reviewId}
      `,
    ).toEqual([
      {
        nextReconciliationAt: expect.toSatisfy(
          (date: Date) => date >= before && date <= new Date(),
        ),
      },
    ]);
    expect(
      await sql`
        select action, outcome, scope ->> 'resourceId' as "resourceId"
        from identity_platform_access_audit
        where grant_id = ${grantId} and action = 'SENSITIVE_CHANGE_ATTEMPTED'
      `,
    ).toEqual([
      {
        action: "SENSITIVE_CHANGE_ATTEMPTED",
        outcome: "SUCCEEDED",
        resourceId: reviewId,
      },
    ]);

    await sql`
      update identity_platform_access_grants
      set status = 'REVOKED', revoked_at = now(), revision = revision + 1
      where id = ${grantId}
    `;
    const denied = await server.inject({
      method: "POST",
      url: `/v2/platform/payment-reviews/${reviewId}/reconciliation`,
      headers,
      payload: {
        grantId,
        reason: "تلاش تطبیق دوباره پس از لغو اجازه پرونده پرداخت",
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "SENSITIVE_SCOPE_REQUIRED" });
    expect(
      await sql`
        select outcome from identity_platform_access_audit
        where grant_id = ${grantId} and outcome = 'STOPPED_AFTER_REVOCATION'
      `,
    ).toEqual([{ outcome: "STOPPED_AFTER_REVOCATION" }]);
  });
});

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
