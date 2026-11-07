import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("superadmin direct case access", () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const actor = randomUUID(),
    caseId = randomUUID(),
    violationId = randomUUID(),
    token = randomBytes(32).toString("base64url");
  let app: Awaited<ReturnType<typeof createApiApp>>;
  beforeAll(async () => {
    app = await createApiApp(apiTestEnvironment);
    await sql`insert into identity_identities (id, status) values (${actor}, 'ACTIVE')`;
    await sql`insert into identity_sessions (id, token_hash, identity_id, audience, expires_at) values (${randomUUID()}, ${createHash("sha256").update(token).digest("hex")}, ${actor}, 'PLATFORM_AGENT', now() + interval '1 hour')`;
    await sql`insert into identity_platform_superadmins (identity_id, granted_at) values (${actor}, now())`;
    const now = new Date();
    await sql`insert into problem_disputes (id, order_id, buyer_identity_id, store_id, status, category, opened_at, deadline_kind, deadline_at, contributions, outcome, version, updated_at) values (${caseId}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, 'UNDER_REVIEW', 'DAMAGED', ${now}, null, null, ${sql.json([{ authorKind: "BUYER", text: "کالا آسیب دیده و نیاز به بررسی دارد.", evidence: [], submittedAt: now.toISOString() }])}, null, 1, ${now})`;
    await sql`insert into problem_violation_cases (id, type, source_kind, source_reference_id, status, opened_at, next_action_code, evidence, action_reason_codes) values (${violationId}, 'FULFILLMENT_NONCOMPLIANCE', 'ORDER', ${randomUUID()}, 'OPEN', ${now}, 'REVIEW_EVIDENCE', '[]'::jsonb, array['VIOLATION_RECORDED'])`;
  });
  afterAll(async () => {
    await app?.close();
    await sql`truncate identity_platform_superadmin_sensitive_audit`;
    await sql`delete from identity_platform_superadmins where identity_id = ${actor}`;
    await sql`delete from identity_sessions where identity_id = ${actor}`;
    await sql`delete from identity_identities where id = ${actor}`;
    await sql`delete from problem_disputes where id = ${caseId}`;
    await sql`delete from problem_violation_cases where id = ${violationId}`;
    await sql.end();
  });
  it("reveals a dispute using a role receipt and records the reason", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/v3/platform/disputes/${caseId}`,
        headers: {
          cookie: `sevo_platform_session=${token}`,
          "x-platform-access-reason": encodeURIComponent(
            "بررسی مدارک همین پرونده اختلاف",
          ),
        },
      });
    expect(response.statusCode).toBe(200);
    expect(response.json().access).toMatchObject({
      source: "SUPERADMIN",
      actorIdentityId: actor,
      scope: { resourceId: caseId },
    });
    expect(response.json().access).not.toHaveProperty("grantId");
    expect(response.json().access).not.toHaveProperty("expiresAt");
    const audit =
      await sql`select outcome from identity_platform_superadmin_sensitive_audit where actor_identity_id = ${actor} and resource_id = ${caseId}`;
    expect(audit).toEqual([{ outcome: "ALLOWED" }]);
  });
  it("records a dispute decision directly with separate change and reveal audits", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/v3/platform/disputes/${caseId}/resolution`,
        headers: {
          cookie: `sevo_platform_session=${token}`,
          "x-platform-access-reason": encodeURIComponent(
            "بررسی مدارک و ثبت نتیجه اختلاف",
          ),
          "idempotency-key": randomUUID(),
        },
        payload: {
          status: "RESOLVED",
          outcomeCode: "PARTIES_REACHED_AGREEMENT",
          explanation: "مدارک بررسی شد و دو طرف بر قدم بعدی توافق کردند.",
          evidence: [],
        },
      });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "RESOLVED",
      access: { source: "SUPERADMIN" },
    });
    const audit = await sql<
      Array<{ action: string }>
    >`select action from identity_platform_superadmin_sensitive_audit where actor_identity_id = ${actor} and resource_id = ${caseId} order by occurred_at`;
    expect(audit.map((row) => row.action)).toEqual([
      "REVEAL_MINIMUM",
      "UPDATE_CASE_STATUS",
      "REVEAL_MINIMUM",
    ]);
  });
  it("reveals violation details with a role-backed audited receipt", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/v3/platform/violations/${violationId}`,
        headers: {
          cookie: `sevo_platform_session=${token}`,
          "x-platform-access-reason": encodeURIComponent(
            "بررسی مدارک همین پرونده تخلف",
          ),
        },
      });
    expect(response.statusCode).toBe(200);
    expect(response.json().access).toMatchObject({
      source: "SUPERADMIN",
      actorIdentityId: actor,
      scope: { resourceId: violationId },
    });
    expect(response.json().access).not.toHaveProperty("expiresAt");
  });
  it("rejects a limited dispute reviewer from the direct path and records the attempt", async () => {
    await sql`update identity_platform_superadmins set revoked_at = now() where identity_id = ${actor}`;
    try {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "GET",
          url: `/v3/platform/disputes/${caseId}`,
          headers: {
            cookie: `sevo_platform_session=${token}`,
            "x-platform-access-reason": encodeURIComponent(
              "بررسی مدارک همین پرونده اختلاف",
            ),
          },
        });
      expect(response.statusCode).toBe(403);
      const rows =
        await sql`select outcome from identity_platform_superadmin_sensitive_audit where actor_identity_id = ${actor} and resource_id = ${caseId} and outcome = 'DENIED'`;
      expect(rows).toEqual([{ outcome: "DENIED" }]);
    } finally {
      await sql`update identity_platform_superadmins set revoked_at = null where identity_id = ${actor}`;
    }
  });
});
