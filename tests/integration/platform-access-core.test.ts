import { createHash, randomBytes, randomUUID } from "node:crypto";

import postgres, { type Sql } from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { createOpaquePlatformAccessTransactionContext } from "../../apps/api/src/modules/identity-access/composition";
import {
  PLATFORM_SENSITIVE_ACCESS,
  PlatformAccessError,
  type PlatformSensitiveAccess,
} from "../../apps/api/src/modules/identity-access/public";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("platform responsibility and sensitive access API with PostgreSQL", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    await resetPlatformAccessData();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await resetPlatformAccessData();
  });

  it("activates a high-risk responsibility only through the explicit single-manager exception and rejects self-grant", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const manager = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const recipient = await seedAgent([]);

    const malformedKey = await server.inject({
      method: "POST",
      url: "/v1/platform/access/responsibility-grants",
      headers: {
        ...accessHeaders(manager.token),
        "idempotency-key": "not-a-uuid",
      },
      payload: {
        recipientIdentityId: recipient.identityId,
        responsibility: "PAYMENT_REVIEW",
        reason: "واگذاری مسئولیت بررسی پرداخت پرونده",
      },
    });
    expect(malformedKey.statusCode).toBe(422);

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
    expect(audit).toHaveLength(2);
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

  it("makes a queued single-manager revocation stop a concurrent sensitive use", async () => {
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
        reason: "واگذاری مسئولیت بررسی پرداخت برای آزمون رقابت لغو",
      },
    });
    expect(responsibility.statusCode).toBe(202);

    const resourceId = randomUUID();
    const assigned = await server.inject({
      method: "POST",
      url: "/v1/platform/access/sensitive-grants",
      headers: accessHeaders(manager.token),
      payload: {
        recipientIdentityId: agent.identityId,
        responsibility: "PAYMENT_REVIEW",
        purposeCode: "RESOLVE_ASSIGNED_CASE",
        reason: "تخصیص پرونده برای آزمون رقابت لغو",
        scope: {
          resourceType: "PAYMENT_REVIEW",
          resourceId,
          allowedActions: ["REVEAL_MINIMUM"],
        },
        ttlMinutes: 30,
      },
    });
    expect(assigned.statusCode).toBe(202);
    expect(assigned.json()).toMatchObject({
      status: "ACTIVE",
      singleManagerException: true,
    });
    const grantId = assigned.json<{ grantId: string }>().grantId;

    const blocker = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const observer = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const actionSql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const lockAcquired = deferred();
    const releaseLock = deferred();
    const blockingTransaction = blocker.begin(async (transaction) => {
      await transaction`
        select id from identity_platform_access_grants
        where id = ${grantId} for update
      `;
      lockAcquired.resolve();
      await releaseLock.promise;
    });

    try {
      await lockAcquired.promise;
      const revocation = server.inject({
        method: "POST",
        url: `/v1/platform/access/sensitive-grants/${grantId}/revocation`,
        headers: accessHeaders(manager.token),
        payload: {
          expectedRevision: 1,
          reason: "لغو فوری پیش از استفاده هم‌زمان از پرونده",
        },
      });
      await waitForPlatformGrantLockWaiter(observer);

      const access = app.get<PlatformSensitiveAccess>(PLATFORM_SENSITIVE_ACCESS);
      const correlationId = randomUUID();
      let mutationRan = false;
      const sensitiveUse = actionSql.begin(async (transaction) => {
        await access.authorizeSensitiveAction(
          createOpaquePlatformAccessTransactionContext(transaction),
          {
            grantId,
            actorIdentityId: agent.identityId,
            responsibility: "PAYMENT_REVIEW",
            resourceType: "PAYMENT_REVIEW",
            resourceId,
            action: "REVEAL_MINIMUM",
            reason: "تلاش هم‌زمان برای مشاهده پس از آغاز لغو",
            correlationId,
          },
        );
        mutationRan = true;
      });

      releaseLock.resolve();
      await blockingTransaction;
      const revoked = await revocation;
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json()).toMatchObject({ status: "REVOKED", revision: 2 });
      await expect(sensitiveUse).rejects.toMatchObject<Partial<PlatformAccessError>>({
        code: "SENSITIVE_SCOPE_REQUIRED",
      });
      expect(mutationRan).toBe(false);

      const stopped = await observer<
        Array<{ outcome: string; singleManagerException: boolean }>
      >`
        select outcome, single_manager_exception as "singleManagerException"
        from identity_platform_access_audit
        where grant_id = ${grantId} and correlation_id = ${correlationId}
      `;
      expect(stopped).toEqual([
        { outcome: "STOPPED_AFTER_REVOCATION", singleManagerException: true },
      ]);
    } finally {
      releaseLock.resolve();
      await blockingTransaction;
      await Promise.all([blocker.end(), observer.end(), actionSql.end()]);
    }
  });

  it.each([
    {
      lockTarget: "permission",
      waitingQuery: "identity_platform_permission_grants",
    },
    { lockTarget: "grant", waitingQuery: "identity_platform_access_grants" },
  ])(
    "does not issue a receipt when access expires while authorization waits for its $lockTarget lock",
    async ({ lockTarget, waitingQuery }) => {
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
          reason: "واگذاری مسئولیت برای آزمون انقضای هم‌زمان",
        },
      });
      expect(responsibility.statusCode).toBe(202);

      const resourceId = randomUUID();
      const assigned = await server.inject({
        method: "POST",
        url: "/v1/platform/access/sensitive-grants",
        headers: accessHeaders(manager.token),
        payload: {
          recipientIdentityId: agent.identityId,
          responsibility: "PAYMENT_REVIEW",
          purposeCode: "RESOLVE_ASSIGNED_CASE",
          reason: "تخصیص پرونده برای آزمون انقضای هم‌زمان",
          scope: {
            resourceType: "PAYMENT_REVIEW",
            resourceId,
            allowedActions: ["REVEAL_MINIMUM"],
          },
          ttlMinutes: 30,
        },
      });
      expect(assigned.statusCode).toBe(202);
      const grantId = assigned.json<{ grantId: string }>().grantId;

      const blocker = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
      const observer = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
      const actionSql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
      const actionBackend = await actionSql<Array<{ pid: number }>>`
      select pg_backend_pid() as pid
    `;
      await observer`
      update identity_platform_access_grants
      set expires_at = clock_timestamp() + interval '500 milliseconds'
      where id = ${grantId}
    `;
      const lockAcquired = deferred();
      const releaseLock = deferred();
      const blockingTransaction = blocker.begin(async (transaction) => {
        if (lockTarget === "permission") {
          await transaction`
          select id from identity_platform_permission_grants
          where identity_id = ${agent.identityId}
            and permission = 'PAYMENT_REVIEW'
            and revoked_at is null
          for update
        `;
        } else {
          await transaction`
          select id from identity_platform_access_grants
          where id = ${grantId}
          for update
        `;
        }
        lockAcquired.resolve();
        await releaseLock.promise;
      });

      try {
        await lockAcquired.promise;
        const access = app.get<PlatformSensitiveAccess>(PLATFORM_SENSITIVE_ACCESS);
        const correlationId = randomUUID();
        const sensitiveUse = actionSql
          .begin((transaction) =>
            access.authorizeSensitiveAction(
              createOpaquePlatformAccessTransactionContext(transaction),
              {
                grantId,
                actorIdentityId: agent.identityId,
                responsibility: "PAYMENT_REVIEW",
                resourceType: "PAYMENT_REVIEW",
                resourceId,
                action: "REVEAL_MINIMUM",
                reason: "تلاش برای مشاهده پس از انقضا هنگام انتظار قفل",
                correlationId,
              },
            ),
          )
          .then(
            (receipt) => ({ receipt }),
            (error: unknown) => ({ error }),
          );
        await waitForSensitiveAuthorizationLockWaiter(
          observer,
          actionBackend[0]!.pid,
          waitingQuery,
        );
        await waitUntilGrantExpires(observer, grantId);

        releaseLock.resolve();
        await blockingTransaction;
        await expect(sensitiveUse).resolves.toMatchObject({
          error: { code: "SENSITIVE_SCOPE_REQUIRED" },
        });
        const expired = await observer<
          Array<{
            status: string;
            expiryAuditCount: number;
            expiryEventCount: number;
            denialAuditCount: number;
          }>
        >`
        select g.status,
          (select count(*)::int from identity_platform_access_audit a
           where a.grant_id = g.id and a.action = 'GRANT_EXPIRED')
            as "expiryAuditCount",
          (select count(*)::int from platform_outbox_events e
           where e.aggregate_id = g.id
             and e.event_type = 'SensitiveAccessExpired.v1')
            as "expiryEventCount",
          (select count(*)::int from identity_platform_access_audit a
           where a.grant_id = g.id and a.correlation_id = ${correlationId}
             and a.outcome = 'DENIED') as "denialAuditCount"
        from identity_platform_access_grants g where g.id = ${grantId}
      `;
        expect(expired).toEqual([
          {
            status: "EXPIRED",
            expiryAuditCount: 1,
            expiryEventCount: 1,
            denialAuditCount: 1,
          },
        ]);
      } finally {
        releaseLock.resolve();
        await blockingTransaction;
        await Promise.all([blocker.end(), observer.end(), actionSql.end()]);
      }
    },
  );

  it("durably audits nonexistent and wrong-kind sensitive grant references", async () => {
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
        reason: "واگذاری مسئولیت برای آزمون ممیزی شناسه نامعتبر",
      },
    });
    expect(responsibility.statusCode).toBe(202);
    const wrongKindGrantId = responsibility.json<{ grantId: string }>().grantId;
    const nonexistentGrantId = randomUUID();
    const resourceId = randomUUID();
    const attempts = [
      { grantId: nonexistentGrantId, correlationId: randomUUID() },
      { grantId: wrongKindGrantId, correlationId: randomUUID() },
    ];
    const actionSql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    let mutationCount = 0;

    try {
      for (const attempt of attempts) {
        await expect(
          actionSql.begin(async (transaction) => {
            const access = app.get<PlatformSensitiveAccess>(PLATFORM_SENSITIVE_ACCESS);
            await access.authorizeSensitiveAction(
              createOpaquePlatformAccessTransactionContext(transaction),
              {
                grantId: attempt.grantId,
                actorIdentityId: agent.identityId,
                responsibility: "PAYMENT_REVIEW",
                resourceType: "PAYMENT_REVIEW",
                resourceId,
                action: "REVEAL_MINIMUM",
                reason: "تلاش ردشده با شناسه اجازه حساس نامعتبر",
                correlationId: attempt.correlationId,
              },
            );
            mutationCount += 1;
          }),
        ).rejects.toMatchObject<Partial<PlatformAccessError>>({
          code: "SENSITIVE_SCOPE_REQUIRED",
        });
      }
      expect(mutationCount).toBe(0);

      const unresolved = await actionSql<
        Array<{
          attemptedGrantId: string;
          resolvedGrantId: string | null;
          attemptedResponsibility: string | null;
          action: string;
          actorIdentityId: string;
          subjectIdentityId: string | null;
          outcome: string;
          singleManagerException: boolean | null;
          correlationId: string;
        }>
      >`
        select grant_id as "attemptedGrantId", action,
          resolved_grant_id as "resolvedGrantId",
          attempted_responsibility as "attemptedResponsibility",
          actor_identity_id as "actorIdentityId",
          subject_identity_id as "subjectIdentityId", outcome,
          single_manager_exception as "singleManagerException",
          correlation_id as "correlationId"
        from identity_platform_access_audit
        where correlation_id in (${attempts[0].correlationId}, ${attempts[1].correlationId})
        order by correlation_id
      `;
      expect(unresolved).toHaveLength(2);
      expect(unresolved).toEqual(
        expect.arrayContaining(
          attempts.map((attempt) => ({
            attemptedGrantId: attempt.grantId,
            resolvedGrantId: null,
            attemptedResponsibility: "PAYMENT_REVIEW",
            action: "SENSITIVE_FIELD_REVEALED",
            actorIdentityId: agent.identityId,
            subjectIdentityId: null,
            outcome: "DENIED",
            singleManagerException: null,
            correlationId: attempt.correlationId,
          })),
        ),
      );
    } finally {
      await actionSql.end({ timeout: 0 });
    }
  });

  it("audits a share-first denial without blocking queued single-manager revocation", async () => {
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
        reason: "واگذاری مسئولیت بررسی پرداخت برای آزمون رقابت رد و لغو",
      },
    });
    expect(responsibility.statusCode).toBe(202);

    const resourceId = randomUUID();
    const assigned = await server.inject({
      method: "POST",
      url: "/v1/platform/access/sensitive-grants",
      headers: accessHeaders(manager.token),
      payload: {
        recipientIdentityId: agent.identityId,
        responsibility: "PAYMENT_REVIEW",
        purposeCode: "RESOLVE_ASSIGNED_CASE",
        reason: "تخصیص پرونده برای آزمون رقابت رد و لغو",
        scope: {
          resourceType: "PAYMENT_REVIEW",
          resourceId,
          allowedActions: ["REVEAL_MINIMUM"],
        },
        ttlMinutes: 30,
      },
    });
    expect(assigned.statusCode).toBe(202);
    expect(assigned.json()).toMatchObject({
      status: "ACTIVE",
      singleManagerException: true,
    });
    const grantId = assigned.json<{ grantId: string }>().grantId;

    const blocker = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const observer = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const actionSql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const lockAcquired = deferred();
    const releaseLock = deferred();
    const blockingTransaction = blocker.begin(async (transaction) => {
      await transaction`lock table identity_platform_access_audit in access exclusive mode`;
      lockAcquired.resolve();
      await releaseLock.promise;
    });
    let completed = false;

    try {
      await lockAcquired.promise;

      const access = app.get<PlatformSensitiveAccess>(PLATFORM_SENSITIVE_ACCESS);
      const correlationId = randomUUID();
      let mutationRan = false;
      const deniedUse = actionSql.begin(async (transaction) => {
        await access.authorizeSensitiveAction(
          createOpaquePlatformAccessTransactionContext(transaction),
          {
            grantId,
            actorIdentityId: agent.identityId,
            responsibility: "PAYMENT_REVIEW",
            resourceType: "PAYMENT_REVIEW",
            resourceId: randomUUID(),
            action: "REVEAL_MINIMUM",
            reason: "رد درخواست خارج از محدوده پیش از لغو هم‌زمان",
            correlationId,
          },
        );
        mutationRan = true;
      });
      await waitForAuditTableWaiters(observer, 1);

      const revocation = server.inject({
        method: "POST",
        url: `/v1/platform/access/sensitive-grants/${grantId}/revocation`,
        headers: accessHeaders(manager.token),
        payload: {
          expectedRevision: 1,
          reason: "لغو فوری پس از آغاز درخواست ردشده",
        },
      });
      await waitForAuditTableWaiters(observer, 2);
      releaseLock.resolve();
      await blockingTransaction;

      const settled = await Promise.allSettled([deniedUse, revocation]);
      completed = true;

      const [denialResult, revocationResult] = settled;
      expect(denialResult).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ code: "SENSITIVE_SCOPE_REQUIRED" }),
      });
      expect(revocationResult.status).toBe("fulfilled");
      if (revocationResult.status !== "fulfilled") return;
      expect(revocationResult.value.statusCode).toBe(200);
      expect(revocationResult.value.json()).toMatchObject({
        status: "REVOKED",
        revision: 2,
      });
      expect(mutationRan).toBe(false);

      const denied = await observer<Array<{ outcome: string }>>`
        select outcome from identity_platform_access_audit
        where grant_id = ${grantId} and correlation_id = ${correlationId}
      `;
      expect(denied).toEqual([{ outcome: "DENIED" }]);
    } finally {
      releaseLock.resolve();
      if (!completed) {
        await observer`
          select pg_terminate_backend(pid)
          from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid()
        `;
      }
      await Promise.allSettled([blockingTransaction]);
      await Promise.allSettled([
        blocker.end({ timeout: 0 }),
        observer.end({ timeout: 0 }),
        actionSql.end({ timeout: 0 }),
      ]);
    }
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

    const assigned = await server.inject({
      method: "POST",
      url: "/v1/platform/access/sensitive-grants",
      headers: accessHeaders(manager.token),
      payload: { ...requestPayload, recipientIdentityId: agent.identityId },
    });
    expect(assigned.statusCode).toBe(202);
    expect(assigned.json()).toMatchObject({
      status: "ACTIVE",
      singleManagerException: true,
    });
    const assignmentSql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const assignmentAudit = await assignmentSql<Array<{ action: string }>>`
      select action from identity_platform_access_audit
      where grant_id = ${assigned.json<{ grantId: string }>().grantId}
      order by occurred_at, id
    `;
    await assignmentSql.end();
    expect(assignmentAudit.map((entry) => entry.action).sort()).toEqual([
      "GRANT_ACTIVATED",
      "GRANT_REQUESTED",
    ]);

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
    const approvedGrant = approved.json<{ expiresAt: string }>();

    const access = app.get<PlatformSensitiveAccess>(PLATFORM_SENSITIVE_ACCESS);
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const beforeAuthorization = Date.now();
    const receipt = await sql.begin((transaction) =>
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
    expect(receipt).toMatchObject({
      grantId,
      scope: {
        resourceType: "PAYMENT_REVIEW",
        resourceId,
        allowedActions: ["REVEAL_MINIMUM"],
      },
      expiresAt: approvedGrant.expiresAt,
    });
    expect(Object.keys(receipt).sort()).toEqual([
      "accessedAt",
      "expiresAt",
      "grantId",
      "scope",
    ]);
    expect(new Date(receipt.accessedAt).getTime()).toBeGreaterThanOrEqual(
      beforeAuthorization,
    );
    expect(new Date(receipt.accessedAt).getTime()).toBeLessThanOrEqual(Date.now());

    await sql`
      update identity_platform_access_grants
      set expires_at = now() - interval '1 second'
      where id = ${grantId}
    `;
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
            reason: "تلاش برای مشاهده پس از پایان مهلت دسترسی",
            correlationId: randomUUID(),
          },
        ),
      ),
    ).rejects.toMatchObject<Partial<PlatformAccessError>>({
      code: "SENSITIVE_SCOPE_REQUIRED",
    });
    const expired = await sql<Array<{ status: string; eventCount: number }>>`
      select g.status,
        (select count(*)::int from platform_outbox_events e
         where e.aggregate_id = g.id
           and e.event_type = 'SensitiveAccessExpired.v1') as "eventCount"
      from identity_platform_access_grants g where g.id = ${grantId}
    `;
    expect(expired).toEqual([{ status: "EXPIRED", eventCount: 1 }]);

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
    const audit = await sql<Array<{ action: string; outcome: string }>>`
      select action, outcome from identity_platform_access_audit
      where grant_id = ${grantId} order by occurred_at, id
    `;
    expect(audit.map((entry) => entry.action).sort()).toEqual(
      [
        "GRANT_REQUESTED",
        "GRANT_APPROVED",
        "GRANT_ACTIVATED",
        "SENSITIVE_FIELD_REVEALED",
        "SENSITIVE_FIELD_REVEALED",
        "SENSITIVE_FIELD_REVEALED",
        "GRANT_EXPIRED",
        "GRANT_REVOKED",
      ].sort(),
    );
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "SENSITIVE_FIELD_REVEALED",
          outcome: "DENIED",
        }),
        expect.objectContaining({
          action: "SENSITIVE_FIELD_REVEALED",
          outcome: "STOPPED_AFTER_REVOCATION",
        }),
      ]),
    );
    await sql.end();
  });

  it("runs the single-manager emergency lifecycle and blocks new requests until overdue review completes", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const manager = await seedAgent(["ACCESS_ADMINISTRATION", "ACCESS_AUDIT_REVIEW"]);
    const resourceId = randomUUID();
    const requestPayload = {
      incidentId: "INC-2026-0128",
      reason: "مهار خطر مشخص برای صحت نتیجه پرداخت حادثه",
      scope: {
        resourceType: "PAYMENT_REVIEW",
        resourceId,
        allowedActions: ["READ_MASKED", "CONTAIN_INCIDENT"],
      },
      ttlMinutes: 30,
    };

    const overlong = await server.inject({
      method: "POST",
      url: "/v1/platform/access/emergency-grants",
      headers: accessHeaders(manager.token),
      payload: { ...requestPayload, ttlMinutes: 31 },
    });
    expect(overlong.statusCode).toBe(422);

    const requestHeaders = accessHeaders(manager.token);
    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/access/emergency-grants",
      headers: requestHeaders,
      payload: requestPayload,
    });
    expect(requested.statusCode).toBe(202);
    expect(requested.json()).toMatchObject({
      grantKind: "EMERGENCY_ACCESS",
      subjectIdentityId: manager.identityId,
      incidentId: requestPayload.incidentId,
      status: "PENDING_APPROVAL",
      revision: 1,
      singleManagerException: true,
      reviewStatus: "NOT_DUE",
    });
    const requestedView = requested.json<{
      createdAt: string;
      expiresAt: string;
      reviewDueAt: string;
    }>();
    expect(
      new Date(requestedView.reviewDueAt).getTime() -
        new Date(requestedView.createdAt).getTime(),
    ).toBe(24 * 60 * 60 * 1_000);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/platform/access/emergency-grants",
          headers: requestHeaders,
          payload: requestPayload,
        })
      ).json(),
    ).toEqual(requested.json());
    const grantId = requested.json<{ grantId: string }>().grantId;

    const activated = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/activation`,
      headers: accessHeaders(manager.token),
      payload: { expectedRevision: 1 },
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json()).toMatchObject({
      status: "ACTIVE",
      revision: 2,
      approvedByIdentityId: null,
      singleManagerException: true,
    });
    expect(activated.json<{ expiresAt: string }>().expiresAt).toBe(
      requestedView.expiresAt,
    );

    const closeHeaders = accessHeaders(manager.token);
    const closePayload = {
      expectedRevision: 2,
      reason: "مهار حادثه تکمیل و نشست اضطراری بسته شد",
    };
    const closed = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/closure`,
      headers: closeHeaders,
      payload: closePayload,
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ status: "CLOSED", revision: 3 });
    expect(
      (
        await server.inject({
          method: "POST",
          url: `/v1/platform/access/emergency-grants/${grantId}/closure`,
          headers: closeHeaders,
          payload: closePayload,
        })
      ).json(),
    ).toEqual(closed.json());

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`
      update identity_platform_access_grants
      set review_due_at = now() - interval '1 second'
      where id = ${grantId}
    `;
    const blocked = await server.inject({
      method: "POST",
      url: "/v1/platform/access/emergency-grants",
      headers: accessHeaders(manager.token),
      payload: { ...requestPayload, incidentId: "INC-2026-0128-B" },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: "EMERGENCY_REVIEW_OVERDUE" });

    const reviewed = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/review`,
      headers: accessHeaders(manager.token),
      payload: { expectedRevision: 3, findingCode: "CONTROLS_FOLLOWED" },
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json()).toMatchObject({
      revision: 4,
      reviewStatus: "COMPLETED_WITHOUT_INDEPENDENT_REVIEW",
    });

    const unblocked = await server.inject({
      method: "POST",
      url: "/v1/platform/access/emergency-grants",
      headers: accessHeaders(manager.token),
      payload: { ...requestPayload, incidentId: "INC-2026-0128-C" },
    });
    expect(unblocked.statusCode).toBe(202);
    await sql.end();
  });

  it("makes queued emergency revocation stop a concurrent incident action", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const manager = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const resourceId = randomUUID();
    const incidentId = "INC-2026-0128-RACE";
    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/access/emergency-grants",
      headers: accessHeaders(manager.token),
      payload: {
        incidentId,
        reason: "مهار خطر مشخص برای آزمون رقابت لغو اضطراری",
        scope: {
          resourceType: "PAYMENT_REVIEW",
          resourceId,
          allowedActions: ["CONTAIN_INCIDENT"],
        },
        ttlMinutes: 30,
      },
    });
    const grantId = requested.json<{ grantId: string }>().grantId;
    const activated = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/activation`,
      headers: accessHeaders(manager.token),
      payload: { expectedRevision: 1 },
    });
    expect(activated.statusCode).toBe(200);

    const blocker = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const observer = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const actionSql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const lockAcquired = deferred();
    const releaseLock = deferred();
    const blockingTransaction = blocker.begin(async (transaction) => {
      await transaction`
        select id from identity_platform_access_grants
        where id = ${grantId} for update
      `;
      lockAcquired.resolve();
      await releaseLock.promise;
    });

    try {
      await lockAcquired.promise;
      const revocation = server.inject({
        method: "POST",
        url: `/v1/platform/access/emergency-grants/${grantId}/revocation`,
        headers: accessHeaders(manager.token),
        payload: {
          expectedRevision: 2,
          reason: "لغو فوری دسترسی اضطراری پیش از اقدام هم‌زمان",
        },
      });
      await waitForPlatformGrantLockWaiter(observer);

      const access = app.get<PlatformSensitiveAccess>(PLATFORM_SENSITIVE_ACCESS);
      const correlationId = randomUUID();
      let mutationRan = false;
      const emergencyUse = actionSql.begin(async (transaction) => {
        await access.authorizeEmergencyAction(
          createOpaquePlatformAccessTransactionContext(transaction),
          {
            grantId,
            actorIdentityId: manager.identityId,
            incidentId,
            resourceType: "PAYMENT_REVIEW",
            resourceId,
            action: "CONTAIN_INCIDENT",
            reason: "تلاش هم‌زمان برای مهار حادثه پس از آغاز لغو",
            correlationId,
          },
        );
        mutationRan = true;
      });

      releaseLock.resolve();
      await blockingTransaction;
      const revoked = await revocation;
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json()).toMatchObject({ status: "REVOKED", revision: 3 });
      await expect(emergencyUse).rejects.toMatchObject<Partial<PlatformAccessError>>({
        code: "EMERGENCY_SCOPE_REQUIRED",
      });
      expect(mutationRan).toBe(false);
      const stopped = await observer<Array<{ outcome: string }>>`
        select outcome from identity_platform_access_audit
        where grant_id = ${grantId} and correlation_id = ${correlationId}
      `;
      expect(stopped).toEqual([{ outcome: "STOPPED_AFTER_REVOCATION" }]);
    } finally {
      releaseLock.resolve();
      await blockingTransaction;
      await Promise.all([blocker.end(), observer.end(), actionSql.end()]);
    }
  });

  it("requires independent dual-control approval and independent post-incident review", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const requester = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const approver = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const reviewer = await seedAgent(["ACCESS_AUDIT_REVIEW"]);
    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/access/emergency-grants",
      headers: accessHeaders(requester.token),
      payload: {
        incidentId: "INC-2026-0128-DUAL",
        reason: "مهار خطر مشخص با کنترل مستقل دو مدیر دسترسی",
        scope: {
          resourceType: "PAYMENT_REVIEW",
          resourceId: randomUUID(),
          allowedActions: ["READ_MASKED", "CONTAIN_INCIDENT"],
        },
        ttlMinutes: 30,
      },
    });
    expect(requested.statusCode).toBe(202);
    expect(requested.json()).toMatchObject({
      status: "PENDING_APPROVAL",
      revision: 1,
      singleManagerException: false,
    });
    const grantId = requested.json<{ grantId: string }>().grantId;

    const selfApproval = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/approval`,
      headers: accessHeaders(requester.token),
      payload: { expectedRevision: 1 },
    });
    expect(selfApproval.statusCode).toBe(403);
    expect(selfApproval.json()).toMatchObject({ code: "SELF_APPROVAL_FORBIDDEN" });

    const approved = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/approval`,
      headers: accessHeaders(approver.token),
      payload: { expectedRevision: 1 },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      status: "PENDING_APPROVAL",
      revision: 2,
      approvedByIdentityId: approver.identityId,
    });
    const activated = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/activation`,
      headers: accessHeaders(requester.token),
      payload: { expectedRevision: 2 },
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json()).toMatchObject({ status: "ACTIVE", revision: 3 });
    const revoked = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/revocation`,
      headers: accessHeaders(requester.token),
      payload: {
        expectedRevision: 3,
        reason: "لغو دسترسی پس از پایان نیاز به مهار حادثه",
      },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ status: "REVOKED", revision: 4 });

    const reviewed = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/review`,
      headers: accessHeaders(reviewer.token),
      payload: { expectedRevision: 4, findingCode: "CONTROLS_FOLLOWED" },
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json()).toMatchObject({
      revision: 5,
      reviewStatus: "COMPLETED",
    });
  });

  it("expires emergency access once and rejects incident actions after its fixed deadline", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const manager = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const incidentId = "INC-2026-0128-EXPIRY";
    const resourceId = randomUUID();
    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/access/emergency-grants",
      headers: accessHeaders(manager.token),
      payload: {
        incidentId,
        reason: "مهار خطر مشخص برای آزمون انقضای دسترسی اضطراری",
        scope: {
          resourceType: "PAYMENT_REVIEW",
          resourceId,
          allowedActions: ["CONTAIN_INCIDENT"],
        },
        ttlMinutes: 30,
      },
    });
    const grantId = requested.json<{ grantId: string }>().grantId;
    const activated = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/activation`,
      headers: accessHeaders(manager.token),
      payload: { expectedRevision: 1 },
    });
    expect(activated.statusCode).toBe(200);

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`
      update identity_platform_access_grants
      set expires_at = now() - interval '1 second'
      where id = ${grantId}
    `;
    const expiredList = await server.inject({
      method: "GET",
      url: "/v1/platform/access/emergency-grants?status=EXPIRED&limit=20",
      headers: { cookie: `sevo_platform_session=${manager.token}` },
    });
    expect(expiredList.statusCode).toBe(200);
    expect(expiredList.json()).toMatchObject({
      items: [expect.objectContaining({ grantId, status: "EXPIRED" })],
    });
    const access = app.get<PlatformSensitiveAccess>(PLATFORM_SENSITIVE_ACCESS);
    await expect(
      sql.begin((transaction) =>
        access.authorizeEmergencyAction(
          createOpaquePlatformAccessTransactionContext(transaction),
          {
            grantId,
            actorIdentityId: manager.identityId,
            incidentId,
            resourceType: "PAYMENT_REVIEW",
            resourceId,
            action: "CONTAIN_INCIDENT",
            reason: "تلاش برای مهار حادثه پس از پایان مهلت اضطراری",
            correlationId: randomUUID(),
          },
        ),
      ),
    ).rejects.toMatchObject<Partial<PlatformAccessError>>({
      code: "EMERGENCY_SCOPE_REQUIRED",
    });
    const expired = await sql<Array<{ status: string; eventCount: number }>>`
      select g.status,
        (select count(*)::int from platform_outbox_events e
         where e.aggregate_id = g.id
           and e.event_type = 'EmergencyAccessExpired.v1') as "eventCount"
      from identity_platform_access_grants g where g.id = ${grantId}
    `;
    expect(expired).toEqual([{ status: "EXPIRED", eventCount: 1 }]);
    await sql.end();
  });

  it("rejects emergency use when its grant expires while authorization waits for the grant lock", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const manager = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const incidentId = "INC-2026-0128-EXPIRY-RACE";
    const resourceId = randomUUID();
    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/access/emergency-grants",
      headers: accessHeaders(manager.token),
      payload: {
        incidentId,
        reason: "مهار خطر مشخص برای آزمون انقضا هنگام انتظار قفل",
        scope: {
          resourceType: "PAYMENT_REVIEW",
          resourceId,
          allowedActions: ["CONTAIN_INCIDENT"],
        },
        ttlMinutes: 30,
      },
    });
    const grantId = requested.json<{ grantId: string }>().grantId;
    expect(
      (
        await server.inject({
          method: "POST",
          url: `/v1/platform/access/emergency-grants/${grantId}/activation`,
          headers: accessHeaders(manager.token),
          payload: { expectedRevision: 1 },
        })
      ).statusCode,
    ).toBe(200);

    const blocker = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const observer = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const actionSql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await observer`
      update identity_platform_access_grants
      set expires_at = clock_timestamp() + interval '500 milliseconds'
      where id = ${grantId}
    `;
    const lockAcquired = deferred();
    const releaseLock = deferred();
    const blockingTransaction = blocker.begin(async (transaction) => {
      await transaction`
        select id from identity_platform_access_grants
        where id = ${grantId} for update
      `;
      lockAcquired.resolve();
      await releaseLock.promise;
    });

    try {
      await lockAcquired.promise;
      const access = app.get<PlatformSensitiveAccess>(PLATFORM_SENSITIVE_ACCESS);
      const correlationId = randomUUID();
      const emergencyUse = actionSql
        .begin((transaction) =>
          access.authorizeEmergencyAction(
            createOpaquePlatformAccessTransactionContext(transaction),
            {
              grantId,
              actorIdentityId: manager.identityId,
              incidentId,
              resourceType: "PAYMENT_REVIEW",
              resourceId,
              action: "CONTAIN_INCIDENT",
              reason: "تلاش اضطراری پس از انقضا هنگام انتظار قفل",
              correlationId,
            },
          ),
        )
        .then(
          () => ({ authorized: true }),
          (error: unknown) => ({ error }),
        );
      await waitForPlatformGrantLockWaiter(observer);
      await waitUntilGrantExpires(observer, grantId);

      releaseLock.resolve();
      await blockingTransaction;
      await expect(emergencyUse).resolves.toMatchObject({
        error: { code: "EMERGENCY_SCOPE_REQUIRED" },
      });
      const persisted = await observer<
        Array<{
          status: string;
          expiryAuditCount: number;
          expiryEventCount: number;
          denialAuditCount: number;
        }>
      >`
        select g.status,
          (select count(*)::int from identity_platform_access_audit a
           where a.grant_id = g.id and a.action = 'GRANT_EXPIRED')
            as "expiryAuditCount",
          (select count(*)::int from platform_outbox_events e
           where e.aggregate_id = g.id and e.event_type = 'EmergencyAccessExpired.v1')
            as "expiryEventCount",
          (select count(*)::int from identity_platform_access_audit a
           where a.grant_id = g.id and a.correlation_id = ${correlationId}
             and a.outcome = 'DENIED') as "denialAuditCount"
        from identity_platform_access_grants g where g.id = ${grantId}
      `;
      expect(persisted).toEqual([
        {
          status: "EXPIRED",
          expiryAuditCount: 1,
          expiryEventCount: 1,
          denialAuditCount: 1,
        },
      ]);
    } finally {
      releaseLock.resolve();
      await blockingTransaction;
      await Promise.all([blocker.end(), observer.end(), actionSql.end()]);
    }
  });

  it("does not list an emergency grant as active after it expires while listing waits for its lock", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const manager = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const grantId = await createActiveSingleManagerEmergency(server, manager.token);
    const blocker = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const observer = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await observer`
      update identity_platform_access_grants
      set expires_at = clock_timestamp() + interval '500 milliseconds'
      where id = ${grantId}
    `;
    const lockAcquired = deferred();
    const releaseLock = deferred();
    const blockingTransaction = blocker.begin(async (transaction) => {
      await transaction`
        select id from identity_platform_access_grants
        where id = ${grantId} for update
      `;
      lockAcquired.resolve();
      await releaseLock.promise;
    });

    try {
      await lockAcquired.promise;
      const listing = server.inject({
        method: "GET",
        url: "/v1/platform/access/emergency-grants?limit=20",
        headers: { cookie: `sevo_platform_session=${manager.token}` },
      });
      await waitForPlatformGrantLockWaiter(observer);
      await waitUntilGrantExpires(observer, grantId);

      releaseLock.resolve();
      await blockingTransaction;
      const listed = await listing;
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toMatchObject({
        items: [expect.objectContaining({ grantId, status: "EXPIRED" })],
      });
    } finally {
      releaseLock.resolve();
      await blockingTransaction;
      await Promise.all([blocker.end(), observer.end()]);
    }
  });

  it("returns 409 when the live manager topology no longer matches activation control", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const requester = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/access/emergency-grants",
      headers: accessHeaders(requester.token),
      payload: {
        incidentId: "INC-2026-0128-TOPOLOGY",
        reason: "مهار خطر مشخص پیش از تغییر تعداد مدیران دسترسی",
        scope: {
          resourceType: "PAYMENT_REVIEW",
          resourceId: randomUUID(),
          allowedActions: ["CONTAIN_INCIDENT"],
        },
        ttlMinutes: 30,
      },
    });
    const grantId = requested.json<{ grantId: string }>().grantId;
    await seedAgent(["ACCESS_ADMINISTRATION"]);

    const activation = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/activation`,
      headers: accessHeaders(requester.token),
      payload: { expectedRevision: 1 },
    });

    expect(activation.statusCode).toBe(409);
    expect(activation.json()).toMatchObject({ code: "INVALID_ACCESS_TRANSITION" });
  });

  it("lists pending emergency requests and rejects one through the advertised API", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const requester = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const reviewer = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/access/emergency-grants",
      headers: accessHeaders(requester.token),
      payload: {
        incidentId: "INC-2026-0128-REJECT",
        reason: "درخواست اضطراری برای آزمون مسیر رد مستقل",
        scope: {
          resourceType: "DISPUTE_CASE",
          resourceId: randomUUID(),
          allowedActions: ["READ_MASKED"],
        },
        ttlMinutes: 20,
      },
    });
    const grantId = requested.json<{ grantId: string }>().grantId;

    const listed = await server.inject({
      method: "GET",
      url: "/v1/platform/access/emergency-grants?status=PENDING_APPROVAL&limit=10",
      headers: { cookie: `sevo_platform_session=${reviewer.token}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      items: [expect.objectContaining({ grantId, incidentId: "INC-2026-0128-REJECT" })],
      nextCursor: null,
    });

    const headers = accessHeaders(reviewer.token);
    const rejectionRequest = {
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/rejection`,
      headers,
      payload: {
        expectedRevision: 1,
        reason: "محدوده درخواست با نیاز ثبت‌شده حادثه هم‌خوان نیست",
      },
    } as const;
    const rejected = await server.inject(rejectionRequest);
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      grantId,
      grantKind: "EMERGENCY_ACCESS",
      requestStatus: "REJECTED",
      revision: 2,
    });
    expect((await server.inject(rejectionRequest)).json()).toEqual(rejected.json());

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const persisted = await sql<
      Array<{
        status: string;
        rejectedAt: Date | null;
        rejectionAuditCount: number;
        rejectionEventCount: number;
      }>
    >`
      select g.status, g.rejected_at as "rejectedAt",
        (select count(*)::int from identity_platform_access_audit a
         where a.resolved_grant_id = g.id and a.action = 'GRANT_REJECTED')
          as "rejectionAuditCount",
        (select count(*)::int from platform_outbox_events e
         where e.aggregate_id = g.id and e.event_type = 'EmergencyAccessRejected.v1')
          as "rejectionEventCount"
      from identity_platform_access_grants g where g.id = ${grantId}
    `;
    expect(persisted).toEqual([
      {
        status: "PENDING_APPROVAL",
        rejectedAt: expect.any(Date),
        rejectionAuditCount: 1,
        rejectionEventCount: 1,
      },
    ]);
    await sql.end();
  });

  it("permits self-review only when one platform human exists and supports later independent review", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const requester = await seedAgent(["ACCESS_ADMINISTRATION", "ACCESS_AUDIT_REVIEW"]);
    const grantId = await createClosedSingleManagerEmergency(server, requester.token);

    const selfReviewed = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/review`,
      headers: accessHeaders(requester.token),
      payload: { expectedRevision: 3, findingCode: "CONTROLS_FOLLOWED" },
    });
    expect(selfReviewed.statusCode).toBe(200);
    expect(selfReviewed.json()).toMatchObject({
      revision: 4,
      reviewStatus: "COMPLETED_WITHOUT_INDEPENDENT_REVIEW",
    });

    const independentReviewer = await seedAgent(["ACCESS_AUDIT_REVIEW"]);
    const independentReview = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/review`,
      headers: accessHeaders(independentReviewer.token),
      payload: { expectedRevision: 4, findingCode: "CONTROLS_FOLLOWED" },
    });
    expect(independentReview.statusCode).toBe(200);
    expect(independentReview.json()).toMatchObject({
      revision: 5,
      reviewStatus: "COMPLETED",
    });

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const reviews = await sql<
      Array<{ reviewId: string; reviewMode: string; supersedesReviewId: string | null }>
    >`
      select id as "reviewId", review_mode as "reviewMode",
        supersedes_review_id as "supersedesReviewId"
      from identity_platform_emergency_access_reviews
      where grant_id = ${grantId}
      order by reviewed_at, id
    `;
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      reviewMode: "WITHOUT_INDEPENDENT_REVIEW",
      supersedesReviewId: null,
    });
    expect(reviews[1]).toMatchObject({
      reviewMode: "INDEPENDENT",
      supersedesReviewId: reviews[0]?.reviewId,
    });
    await expect(
      sql`update identity_platform_emergency_access_reviews set finding_code = 'FOLLOW_UP_REQUIRED'`,
    ).rejects.toThrow(/append-only/);
    await sql.end();
  });

  it("blocks self-review when another active platform human exists", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const requester = await seedAgent(["ACCESS_ADMINISTRATION", "ACCESS_AUDIT_REVIEW"]);
    const grantId = await createClosedSingleManagerEmergency(server, requester.token);
    await seedAgent([]);

    const forbiddenSelfReview = await server.inject({
      method: "POST",
      url: `/v1/platform/access/emergency-grants/${grantId}/review`,
      headers: accessHeaders(requester.token),
      payload: { expectedRevision: 3, findingCode: "CONTROLS_FOLLOWED" },
    });
    expect(forbiddenSelfReview.statusCode).toBe(403);
    expect(forbiddenSelfReview.json()).toMatchObject({
      code: "SELF_APPROVAL_FORBIDDEN",
    });
  });

  it("durably audits nonexistent and wrong-kind emergency grant references", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const manager = await seedAgent(["ACCESS_ADMINISTRATION"]);
    const recipient = await seedAgent([]);
    const wrongKind = await server.inject({
      method: "POST",
      url: "/v1/platform/access/responsibility-grants",
      headers: accessHeaders(manager.token),
      payload: {
        recipientIdentityId: recipient.identityId,
        responsibility: "PAYMENT_REVIEW",
        reason: "واگذاری مسئولیت برای آزمون شناسه با نوع نادرست",
      },
    });
    const attempts = [randomUUID(), wrongKind.json<{ grantId: string }>().grantId];
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const access = app.get<PlatformSensitiveAccess>(PLATFORM_SENSITIVE_ACCESS);

    for (const grantId of attempts) {
      await expect(
        sql.begin((transaction) =>
          access.authorizeEmergencyAction(
            createOpaquePlatformAccessTransactionContext(transaction),
            {
              grantId,
              actorIdentityId: manager.identityId,
              incidentId: "INC-2026-0128-UNRESOLVED",
              resourceType: "PAYMENT_REVIEW",
              resourceId: randomUUID(),
              action: "CONTAIN_INCIDENT",
              reason: "رد تلاش اضطراری با شناسه نامعتبر یا نوع نادرست",
              correlationId: randomUUID(),
            },
          ),
        ),
      ).rejects.toMatchObject<Partial<PlatformAccessError>>({
        code: "EMERGENCY_SCOPE_REQUIRED",
      });
    }

    const audit = await sql<
      Array<{
        attemptedGrantId: string;
        attemptedGrantKind: string;
        attemptedIncidentId: string;
        resolvedGrantId: string | null;
      }>
    >`
      select grant_id as "attemptedGrantId",
        attempted_grant_kind as "attemptedGrantKind",
        attempted_incident_id as "attemptedIncidentId",
        resolved_grant_id as "resolvedGrantId"
      from identity_platform_access_audit
      where grant_id in ${sql(attempts)} and attempted_grant_kind = 'EMERGENCY_ACCESS'
      order by grant_id
    `;
    expect(audit).toHaveLength(2);
    expect(audit).toEqual(
      expect.arrayContaining(
        attempts.map((attemptedGrantId) => ({
          attemptedGrantId,
          attemptedGrantKind: "EMERGENCY_ACCESS",
          attemptedIncidentId: "INC-2026-0128-UNRESOLVED",
          resolvedGrantId: null,
        })),
      ),
    );
    await sql.end();
  });
});

async function createClosedSingleManagerEmergency(
  server: {
    inject(input: unknown): Promise<{ json<T = unknown>(): T; statusCode: number }>;
  },
  token: string,
) {
  const grantId = await createActiveSingleManagerEmergency(server, token);
  const closed = await server.inject({
    method: "POST",
    url: `/v1/platform/access/emergency-grants/${grantId}/closure`,
    headers: accessHeaders(token),
    payload: {
      expectedRevision: 2,
      reason: "مهار حادثه تکمیل و نشست اضطراری بسته شد",
    },
  });
  expect(closed.statusCode).toBe(200);
  return grantId;
}

async function createActiveSingleManagerEmergency(
  server: {
    inject(input: unknown): Promise<{ json<T = unknown>(): T; statusCode: number }>;
  },
  token: string,
) {
  const requested = await server.inject({
    method: "POST",
    url: "/v1/platform/access/emergency-grants",
    headers: accessHeaders(token),
    payload: {
      incidentId: `INC-${randomUUID()}`,
      reason: "مهار خطر مشخص برای آزمون بازبینی پسینی",
      scope: {
        resourceType: "PAYMENT_REVIEW",
        resourceId: randomUUID(),
        allowedActions: ["CONTAIN_INCIDENT"],
      },
      ttlMinutes: 30,
    },
  });
  const grantId = requested.json<{ grantId: string }>().grantId;
  const activated = await server.inject({
    method: "POST",
    url: `/v1/platform/access/emergency-grants/${grantId}/activation`,
    headers: accessHeaders(token),
    payload: { expectedRevision: 1 },
  });
  expect(activated.statusCode).toBe(200);
  return grantId;
}

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

async function resetPlatformAccessData() {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  await sql`truncate identity_platform_access_audit`;
  await sql`truncate identity_platform_emergency_access_reviews`;
  await sql`delete from identity_platform_access_idempotency`;
  await sql`delete from identity_platform_access_grants`;
  await sql`delete from identity_platform_permission_grants`;
  await sql`delete from identity_sessions`;
  await sql`delete from identity_login_methods`;
  await sql`delete from identity_identities`;
  await sql.end();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForPlatformGrantLockWaiter(sql: Sql) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await sql<Array<{ waiting: boolean }>>`
      select exists(
        select 1 from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and query like '%identity_platform_access_grants%'
          and query like '%for update%'
      ) as waiting
    `;
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("revocation did not queue on the platform grant lock");
}

async function waitForSensitiveAuthorizationLockWaiter(
  sql: Sql,
  actionPid: number,
  waitingQuery: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await sql<Array<{ waiting: boolean }>>`
      select exists(
        select 1 from pg_stat_activity
        where datname = current_database()
          and pid = ${actionPid}
          and wait_event_type = 'Lock'
          and query like ${`%${waitingQuery}%`}
          and query like '%for share%'
      ) as waiting
    `;
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`sensitive authorization did not wait on its ${waitingQuery} lock`);
}

async function waitUntilGrantExpires(sql: Sql, grantId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await sql<Array<{ expired: boolean }>>`
      select expires_at <= clock_timestamp() as expired
      from identity_platform_access_grants where id = ${grantId}
    `;
    if (rows[0]?.expired) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("sensitive grant did not reach its expiry time");
}

async function waitForAuditTableWaiters(sql: Sql, expected: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await sql<Array<{ waiting: number }>>`
      select count(*)::int as waiting
      from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and query like '%insert into identity_platform_access_audit%'
    `;
    if ((rows[0]?.waiting ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `expected ${expected} audit transaction(s) to reach the table barrier`,
  );
}
