import { createHash, randomBytes, randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { createOpaquePlatformAccessTransactionContext } from "../../apps/api/src/modules/identity-access/composition";
import { PostgresPlatformAccessRepository } from "../../apps/api/src/modules/identity-access/infrastructure/postgres-platform-access.repository";
import { PlatformAccessError } from "../../apps/api/src/modules/identity-access/public";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("platform responsibility and sensitive access API with PostgreSQL", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`truncate identity_platform_access_audit`;
    await sql`delete from identity_platform_access_idempotency`;
    await sql`delete from identity_platform_access_grants`;
    await sql`delete from identity_platform_permission_grants`;
    await sql`delete from identity_sessions`;
    await sql`delete from identity_login_methods`;
    await sql`delete from identity_identities`;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("activates a high-risk responsibility only through the explicit single-manager exception and rejects self-grant", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const manager = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const recipient = await seedAgent([]);

    const selfGrant = await server.inject({
      method: "POST",
      url: "/v1/platform/access/responsibility-grants",
      headers: accessHeaders(manager.token),
      payload: {
        recipientIdentityId: manager.identityId,
        responsibility: "PAYMENT_OUTCOME_CHANGE",
        reason: "واگذاری مسئولیت تغییر نتیجه پرداخت پرونده",
      },
    });
    expect(selfGrant.statusCode).toBe(403);
    expect(selfGrant.json()).toMatchObject({ code: "SELF_GRANT_FORBIDDEN" });

    const grantedHeaders = accessHeaders(manager.token);
    const grantedRequest = {
      method: "POST",
      url: "/v1/platform/access/responsibility-grants",
      headers: grantedHeaders,
      payload: {
        recipientIdentityId: recipient.identityId,
        responsibility: "PAYMENT_OUTCOME_CHANGE",
        reason: "واگذاری مسئولیت تغییر نتیجه پرداخت پرونده",
      },
    } as const;
    const granted = await server.inject(grantedRequest);

    expect(granted.statusCode).toBe(202);
    expect(granted.json()).toMatchObject({
      grantKind: "RESPONSIBILITY",
      subjectIdentityId: recipient.identityId,
      responsibility: "PAYMENT_OUTCOME_CHANGE",
      status: "ACTIVE",
      singleManagerException: true,
      approvedByIdentityId: null,
      revision: 1,
    });
    const replay = await server.inject(grantedRequest);
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toEqual(granted.json());
    const conflict = await server.inject({
      ...grantedRequest,
      payload: { ...grantedRequest.payload, responsibility: "ACCESS_ADMINISTRATION" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const permissions = await sql<Array<{ permission: string }>>`
      select permission from identity_platform_permission_grants
      where identity_id = ${recipient.identityId} and revoked_at is null
      order by permission
    `;
    const audit = await sql<Array<{ immutable: boolean }>>`
      select true as immutable from identity_platform_access_audit
      where grant_id = ${granted.json<{ grantId: string }>().grantId}
    `;
    expect(permissions).toEqual([{ permission: "PAYMENT_OUTCOME_CHANGE" }]);
    expect(audit).toHaveLength(1);
    await expect(
      sql`update identity_platform_access_audit set outcome = 'DENIED'`,
    ).rejects.toThrow(/append-only/);
    const workspace = await server.inject({
      method: "GET",
      url: "/v1/platform/auth/session",
      headers: { cookie: `sevo_platform_session=${manager.token}` },
    });
    expect(workspace.json()).toMatchObject({
      permissions: ["ACCESS_ADMINISTRATION"],
    });
    await sql`
      update identity_sessions set created_at = now() - interval '6 minutes'
      where identity_id = ${manager.identityId} and audience = 'PLATFORM_AGENT'
    `;
    const stale = await server.inject({
      method: "POST",
      url: "/v1/platform/access/responsibility-grants",
      headers: accessHeaders(manager.token),
      payload: {
        recipientIdentityId: randomUUID(),
        responsibility: "PAYMENT_REVIEW",
        reason: "واگذاری مسئولیت بررسی پرداخت پرونده",
      },
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ code: "STRONG_AUTHENTICATION_STALE" });
    await sql.end();
  });

  it("requires a second manager and makes revocation win an approval race", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const requester = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const approver = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const recipient = await seedAgent([]);

    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/access/responsibility-grants",
      headers: accessHeaders(requester.token),
      payload: {
        recipientIdentityId: recipient.identityId,
        responsibility: "PAYMENT_OUTCOME_CHANGE",
        reason: "واگذاری مسئولیت تغییر نتیجه پرداخت پرونده",
      },
    });
    const grant = requested.json<{ grantId: string }>();
    expect(requested.statusCode).toBe(202);
    expect(requested.json()).toMatchObject({
      status: "PENDING_APPROVAL",
      singleManagerException: false,
    });

    const [approval, revocation] = await Promise.all([
      server.inject({
        method: "POST",
        url: `/v1/platform/access/responsibility-grants/${grant.grantId}/approval`,
        headers: accessHeaders(approver.token),
        payload: { expectedRevision: 1 },
      }),
      server.inject({
        method: "POST",
        url: `/v1/platform/access/responsibility-grants/${grant.grantId}/revocation`,
        headers: accessHeaders(requester.token),
        payload: {
          expectedRevision: 1,
          reason: "لغو فوری برای توقف اختیار عملیاتی حساس",
        },
      }),
    ]);

    expect([200, 409]).toContain(approval.statusCode);
    expect(revocation.statusCode).toBe(200);
    expect(revocation.json()).toMatchObject({ status: "REVOKED" });

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const state = await sql<Array<{ status: string; activePermissionCount: number }>>`
      select g.status,
        (select count(*)::int from identity_platform_permission_grants p
         where p.identity_id = ${recipient.identityId}
           and p.permission = 'PAYMENT_OUTCOME_CHANGE'
           and p.revoked_at is null) as "activePermissionCount"
      from identity_platform_access_grants g where g.id = ${grant.grantId}
    `;
    await sql.end();
    expect(state).toEqual([{ status: "REVOKED", activePermissionCount: 0 }]);
  });

  it("bounds sensitive access to one case and transactionally rechecks every reveal after revocation", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const manager = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const agent = await seedAgent([]);
    const responsibility = await server.inject({
      method: "POST",
      url: "/v1/platform/access/responsibility-grants",
      headers: accessHeaders(manager.token),
      payload: {
        recipientIdentityId: agent.identityId,
        responsibility: "PAYMENT_REVIEW",
        reason: "واگذاری مسئولیت بررسی پرداخت پرونده",
      },
    });
    expect(responsibility.statusCode).toBe(202);
    const resourceId = randomUUID();
    const requestPayload = {
      responsibility: "PAYMENT_REVIEW",
      purposeCode: "RESOLVE_ASSIGNED_CASE",
      reason: "بررسی مغایرت نتیجه پرداخت همین پرونده",
      scope: {
        resourceType: "PAYMENT_REVIEW",
        resourceId,
        allowedActions: ["READ_MASKED", "REVEAL_MINIMUM"],
      },
      ttlMinutes: 30,
    };

    const overlong = await server.inject({
      method: "POST",
      url: "/v1/platform/access/sensitive-grants",
      headers: accessHeaders(agent.token),
      payload: { ...requestPayload, ttlMinutes: 61 },
    });
    expect(overlong.statusCode).toBe(422);

    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/access/sensitive-grants",
      headers: accessHeaders(agent.token),
      payload: requestPayload,
    });
    expect(requested.statusCode).toBe(202);
    expect(requested.json()).toMatchObject({
      grantKind: "SENSITIVE_ACCESS",
      subjectIdentityId: agent.identityId,
      status: "PENDING_APPROVAL",
      scope: requestPayload.scope,
    });
    const grantId = requested.json<{ grantId: string }>().grantId;

    const approved = await server.inject({
      method: "POST",
      url: `/v1/platform/access/sensitive-grants/${grantId}/approval`,
      headers: accessHeaders(manager.token),
      payload: { expectedRevision: 1 },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "ACTIVE", revision: 2 });

    const access = new PostgresPlatformAccessRepository(
      apiTestEnvironment.DATABASE_URL,
    );
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql.begin((transaction) =>
      access.authorizeSensitiveAction(
        createOpaquePlatformAccessTransactionContext(transaction),
        {
          grantId,
          actorIdentityId: agent.identityId,
          responsibility: "PAYMENT_REVIEW",
          resourceType: "PAYMENT_REVIEW",
          resourceId,
          action: "REVEAL_MINIMUM",
          reason: "آشکارسازی حداقل داده برای بررسی پرونده",
          correlationId: randomUUID(),
        },
      ),
    );

    const revoked = await server.inject({
      method: "POST",
      url: `/v1/platform/access/sensitive-grants/${grantId}/revocation`,
      headers: accessHeaders(manager.token),
      payload: {
        expectedRevision: 2,
        reason: "پایان نیاز عملیاتی به مشاهده پرونده",
      },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ status: "REVOKED" });

    await expect(
      sql.begin((transaction) =>
        access.authorizeSensitiveAction(
          createOpaquePlatformAccessTransactionContext(transaction),
          {
            grantId,
            actorIdentityId: agent.identityId,
            responsibility: "PAYMENT_REVIEW",
            resourceType: "PAYMENT_REVIEW",
            resourceId,
            action: "REVEAL_MINIMUM",
            reason: "تلاش دوباره برای مشاهده پس از لغو",
            correlationId: randomUUID(),
          },
        ),
      ),
    ).rejects.toMatchObject<Partial<PlatformAccessError>>({
      code: "SENSITIVE_SCOPE_REQUIRED",
    });
    const audit = await sql<Array<{ action: string }>>`
      select action from identity_platform_access_audit
      where grant_id = ${grantId} order by occurred_at, id
    `;
    expect(audit.map((entry) => entry.action)).toEqual([
      "GRANT_REQUESTED",
      "GRANT_APPROVED",
      "SENSITIVE_FIELD_REVEALED",
      "GRANT_REVOKED",
    ]);
    await sql.end();
    await access.onModuleDestroy();
  });
});

function accessHeaders(token: string) {
  return {
    cookie: `sevo_platform_session=${token}`,
    "idempotency-key": randomUUID(),
    "x-correlation-id": randomUUID(),
  };
}

async function seedAgent(permissions: readonly string[]) {
  const identityId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  await sql.begin(async (transaction) => {
    await transaction`
      insert into identity_identities (id, status) values (${identityId}, 'ACTIVE')
    `;
    await transaction`
      insert into identity_sessions
        (id, token_hash, identity_id, audience, expires_at, created_at)
      values
        (${randomUUID()}, ${hash(token)}, ${identityId}, 'PLATFORM_AGENT',
         now() + interval '1 hour', now())
    `;
    for (const permission of permissions) {
      await transaction`
        insert into identity_platform_permission_grants
          (id, identity_id, permission, granted_at)
        values (${randomUUID()}, ${identityId}, ${permission}, now())
      `;
    }
  });
  await sql.end();
  return { identityId, token };
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
