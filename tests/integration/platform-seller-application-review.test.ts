import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

import { iranianMobileContract } from "@sevo/contracts/identity-access/v1";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { startSellerApprovalRecoveryPoller } from "../../apps/worker/src/modules/identity-access/index";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("platform seller application review API with PostgreSQL", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];
  const environment = {
    ...apiTestEnvironment,
    DEV_OTP_TEST_MOBILES: [
      "09123456789",
      "09123456788",
      "09123456787",
      "09123456786",
      "09123456785",
    ].map((mobile) => iranianMobileContract.parse(mobile)),
  };

  beforeEach(async () => {
    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    await sql`truncate identity_totp_bootstrap_run`;
    await sql`truncate identity_platform_permission_audit`;
    await sql`delete from identity_platform_permission_grants`;
    await sql`delete from identity_seller_application_idempotency`;
    await sql`delete from identity_seller_approval_recoveries`;
    await sql`truncate identity_seller_application_audit`;
    await sql`delete from identity_seller_application_decisions`;
    await sql`delete from identity_seller_application_revisions`;
    await sql`delete from identity_seller_applications`;
    await sql`delete from identity_seller_access`;
    await sql`
      delete from platform_outbox_consumptions
      where event_id in (
        select event_id from platform_outbox_events
        where event_type in ('SellerApplicationApproved.v1',
                             'SellerAccessActivated.v1')
      )
    `;
    await sql`
      delete from platform_outbox_events
      where event_type like 'SellerApplication%'
         or event_type = 'SellerAccessActivated.v1'
    `;
    await sql`delete from identity_sessions`;
    await sql`delete from identity_otp_challenges`;
    await sql`delete from identity_login_methods`;
    await sql`delete from identity_identities`;
    await sql.end();
  });

  it("approves once and atomically provisions active seller access with an unpublished store", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const applicantCookie = await signIn(app, "09123456786");
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { cookie: applicantCookie, "idempotency-key": randomUUID() },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;
    const applicantIdentityId = await identityIdForMobile("09123456786");

    await signIn(app, "09123456785");
    const agentIdentityId = await identityIdForMobile("09123456785");
    const token = await seedPlatformSession(agentIdentityId);
    await grantReviewPermission(agentIdentityId);
    const correlationId = randomUUID();
    const idempotencyKey = randomUUID();
    const payload = {
      expectedRevision: 1,
      reasonCode: "ELIGIBILITY_CONFIRMED",
    };
    const request = () =>
      server.inject({
        method: "POST",
        url: `/v1/platform/seller-applications/${applicationId}/approval`,
        headers: {
          cookie: platformCookie(token),
          "x-correlation-id": correlationId,
          "idempotency-key": idempotencyKey,
        },
        payload,
      });

    const approved = await request();
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ applicationId, revision: 2 });
    expect(approved.json()).toHaveProperty("sellerAccessId");
    expect(approved.json()).toHaveProperty("storeId");
    const replay = await request();
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(approved.json());

    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      const state = await sql<
        Array<{
          status: string;
          revision: number;
          accessCount: number;
          storeCount: number;
          membershipCount: number;
          storeStatus: string;
          storeName: string;
          auditCount: number;
          eventCount: number;
        }>
      >`
        select a.status, a.aggregate_version as revision,
          (select count(*)::int from identity_seller_access sa
           where sa.identity_id = ${applicantIdentityId}) as "accessCount",
          (select count(*)::int from store_stores s
           join store_memberships m on m.store_id = s.id
           where m.seller_id = ${applicantIdentityId}) as "storeCount",
          (select count(*)::int from store_memberships m
           where m.seller_id = ${applicantIdentityId} and m.role = 'OWNER')
             as "membershipCount",
          (select s.status from store_stores s
           join store_memberships m on m.store_id = s.id
           where m.seller_id = ${applicantIdentityId}) as "storeStatus",
          (select s.name from store_stores s
           join store_memberships m on m.store_id = s.id
           where m.seller_id = ${applicantIdentityId}) as "storeName",
          (select count(*)::int from identity_seller_application_audit au
           where au.target_id = a.id and au.action = 'ApproveSellerApplication.v1'
             and au.result = 'SUCCEEDED') as "auditCount",
          (select count(*)::int from platform_outbox_events e
           where e.correlation_id = ${correlationId}
             and e.event_type in ('SellerApplicationApproved.v1',
                                  'SellerAccessActivated.v1')) as "eventCount"
        from identity_seller_applications a where a.id = ${applicationId}
      `;
      expect(state).toEqual([
        {
          status: "APPROVED",
          revision: 2,
          accessCount: 1,
          storeCount: 1,
          membershipCount: 1,
          storeStatus: "DRAFT",
          storeName: "خانه ماه",
          auditCount: 1,
          eventCount: 2,
        },
      ]);
    } finally {
      await sql.end();
    }

    const mine = await server.inject({
      method: "GET",
      url: "/v1/seller-applications/mine",
      headers: { cookie: applicantCookie },
    });
    expect(mine.json()).toMatchObject({
      items: [
        {
          status: "APPROVED",
          nextStep: "START_SELLER_WORKSPACE",
          timeline: expect.arrayContaining([
            expect.objectContaining({
              status: "APPROVED",
              publicReason: "شرایط فروشندگی شما تأیید شد.",
            }),
          ]),
        },
      ],
    });
    const sellerWorkspace = await server.inject({
      method: "GET",
      url: "/v1/seller/store/draft",
      headers: { cookie: applicantCookie },
    });
    expect(sellerWorkspace.statusCode).toBe(200);
    expect(sellerWorkspace.json()).toMatchObject({
      id: approved.json<{ storeId: string }>().storeId,
      name: "خانه ماه",
      status: "DRAFT",
      revision: 1,
    });
    expect(sellerWorkspace.json()).not.toHaveProperty("publishedAt");
  });

  it("lets only one concurrent approval create seller access and a store", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const applicantCookie = await signIn(app, "09123456786");
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { cookie: applicantCookie, "idempotency-key": randomUUID() },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;
    const applicantIdentityId = await identityIdForMobile("09123456786");
    await signIn(app, "09123456788");
    await signIn(app, "09123456787");
    const firstAgentId = await identityIdForMobile("09123456788");
    const secondAgentId = await identityIdForMobile("09123456787");
    const firstToken = await seedPlatformSession(firstAgentId);
    const secondToken = await seedPlatformSession(secondAgentId);
    await grantReviewPermission(firstAgentId);
    await grantReviewPermission(secondAgentId);
    const payload = {
      expectedRevision: 1,
      reasonCode: "ELIGIBILITY_CONFIRMED",
      publicReason: "شرایط فروشندگی شما تأیید شد.",
    };

    const results = await Promise.all([
      server.inject({
        method: "POST",
        url: `/v1/platform/seller-applications/${applicationId}/approval`,
        headers: {
          cookie: platformCookie(firstToken),
          "idempotency-key": randomUUID(),
        },
        payload,
      }),
      server.inject({
        method: "POST",
        url: `/v1/platform/seller-applications/${applicationId}/approval`,
        headers: {
          cookie: platformCookie(secondToken),
          "idempotency-key": randomUUID(),
        },
        payload,
      }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);

    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      const counts = await sql<
        Array<{ accessCount: number; storeCount: number; decisionCount: number }>
      >`
        select
          (select count(*)::int from identity_seller_access
           where identity_id = ${applicantIdentityId}) as "accessCount",
          (select count(*)::int from store_memberships
           where seller_id = ${applicantIdentityId}) as "storeCount",
          (select count(*)::int from identity_seller_application_decisions
           where application_id = ${applicationId} and action = 'APPROVE')
            as "decisionCount"
      `;
      expect(counts).toEqual([{ accessCount: 1, storeCount: 1, decisionCount: 1 }]);
    } finally {
      await sql.end();
    }
  });

  it("recovers a provision crash through the durable Worker after an API restart", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const applicantCookie = await signIn(app, "09123456786");
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { cookie: applicantCookie, "idempotency-key": randomUUID() },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;
    const applicantIdentityId = await identityIdForMobile("09123456786");
    await signIn(app, "09123456785");
    const agentIdentityId = await identityIdForMobile("09123456785");
    const token = await seedPlatformSession(agentIdentityId);
    await grantReviewPermission(agentIdentityId);
    const idempotencyKey = randomUUID();
    const headers = {
      cookie: platformCookie(token),
      "idempotency-key": idempotencyKey,
    };
    const payload = {
      expectedRevision: 1,
      reasonCode: "ELIGIBILITY_CONFIRMED",
      publicReason: "شرایط فروشندگی شما تأیید شد.",
    };
    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      await sql.unsafe(`
        create function test_fail_store_provision() returns trigger
        language plpgsql as $$ begin raise exception 'simulated provision crash'; end $$;
        create trigger test_fail_store_provision
        before insert on store_stores
        for each row execute function test_fail_store_provision();
      `);
      const failed = await server.inject({
        method: "POST",
        url: `/v1/platform/seller-applications/${applicationId}/approval`,
        headers,
        payload,
      });
      expect(failed.statusCode).toBe(500);

      const rolledBack = await sql<
        Array<{
          status: string;
          accessCount: number;
          storeCount: number;
          failedAuditCount: number;
          recoveryStatus: string;
        }>
      >`
        select a.status,
          (select count(*)::int from identity_seller_access
           where identity_id = ${applicantIdentityId}) as "accessCount",
          (select count(*)::int from store_memberships
           where seller_id = ${applicantIdentityId}) as "storeCount",
          (select count(*)::int from identity_seller_application_audit au
           where au.target_id = a.id and au.action = 'ApproveSellerApplication.v1'
             and au.result = 'FAILED') as "failedAuditCount",
          (select status from identity_seller_approval_recoveries r
           where r.application_id = a.id) as "recoveryStatus"
        from identity_seller_applications a where a.id = ${applicationId}
      `;
      expect(rolledBack).toEqual([
        {
          status: "SUBMITTED",
          accessCount: 0,
          storeCount: 0,
          failedAuditCount: 1,
          recoveryStatus: "PENDING",
        },
      ]);

      await sql`drop trigger test_fail_store_provision on store_stores`;
      await sql`drop function test_fail_store_provision()`;
      await app.close();
      apps.splice(apps.indexOf(app), 1);
      let restartedApp: Awaited<ReturnType<typeof createApiApp>> | undefined;
      let unavailableAttempts = 0;
      const stopWorker = startSellerApprovalRecoveryPoller(
        {
          async nextPending() {
            if (!restartedApp) {
              unavailableAttempts += 1;
              throw new Error("API unavailable");
            }
            const response = await restartedApp
              .getHttpAdapter()
              .getInstance()
              .inject({
                method: "GET",
                url: "/v1/internal/seller-approval-recoveries/pending",
                headers: {
                  "x-sevo-worker-secret": environment.SELLER_APPROVAL_RECOVERY_SECRET,
                },
              });
            if (response.statusCode !== 200) {
              throw new Error(`Recovery poll returned ${response.statusCode}`);
            }
            return response.json<{ recoveryId: string | null }>().recoveryId;
          },
          async recover(recoveryId) {
            if (!restartedApp) throw new Error("API unavailable");
            const response = await restartedApp
              .getHttpAdapter()
              .getInstance()
              .inject({
                method: "POST",
                url: `/v1/internal/seller-approval-recoveries/${recoveryId}`,
                headers: {
                  "x-sevo-worker-secret": environment.SELLER_APPROVAL_RECOVERY_SECRET,
                },
              });
            if (response.statusCode !== 204) {
              throw new Error(`Recovery endpoint returned ${response.statusCode}`);
            }
          },
        },
        1,
      );
      try {
        await waitUntil(() => unavailableAttempts > 5);
        restartedApp = await createApiApp(environment);
        apps.push(restartedApp);
        await waitUntil(async () => {
          const rows = await sql<Array<{ status: string }>>`
            select status from identity_seller_approval_recoveries
            where application_id = ${applicationId}
          `;
          return rows[0]?.status === "COMPLETED";
        });
      } finally {
        await stopWorker();
      }
      const recovered = await sql<
        Array<{
          status: string;
          accessCount: number;
          storeCount: number;
          recoveryStatus: string;
        }>
      >`
        select a.status,
          (select count(*)::int from identity_seller_access
           where identity_id = ${applicantIdentityId}) as "accessCount",
          (select count(*)::int from store_memberships
           where seller_id = ${applicantIdentityId}) as "storeCount",
          (select status from identity_seller_approval_recoveries r
           where r.application_id = a.id) as "recoveryStatus"
        from identity_seller_applications a where a.id = ${applicationId}
      `;
      expect(recovered).toEqual([
        {
          status: "APPROVED",
          accessCount: 1,
          storeCount: 1,
          recoveryStatus: "COMPLETED",
        },
      ]);
    } finally {
      await sql.unsafe(`
        drop trigger if exists test_fail_store_provision on store_stores;
        drop function if exists test_fail_store_provision();
      `);
      await sql.end();
    }
  });

  it("cancels a revoked recovery without starving the next valid approval", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const firstApplicantCookie = await signIn(app, "09123456786");
    const secondApplicantCookie = await signIn(app, "09123456787");
    const firstApplicationId = (
      await server.inject({
        method: "POST",
        url: "/v1/seller-applications",
        headers: {
          cookie: firstApplicantCookie,
          "idempotency-key": randomUUID(),
        },
        payload: { ...applicationPayload(), proposedStoreName: "خانه اول" },
      })
    ).json<{ applicationId: string }>().applicationId;
    const secondApplicationId = (
      await server.inject({
        method: "POST",
        url: "/v1/seller-applications",
        headers: {
          cookie: secondApplicantCookie,
          "idempotency-key": randomUUID(),
        },
        payload: { ...applicationPayload(), proposedStoreName: "خانه دوم" },
      })
    ).json<{ applicationId: string }>().applicationId;

    await signIn(app, "09123456785");
    await signIn(app, "09123456788");
    const revokedAgentId = await identityIdForMobile("09123456785");
    const activeAgentId = await identityIdForMobile("09123456788");
    await grantReviewPermission(revokedAgentId);
    await grantReviewPermission(activeAgentId);
    const revokedToken = await seedPlatformSession(revokedAgentId);
    const activeToken = await seedPlatformSession(activeAgentId);
    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      await sql.unsafe(`
        create function test_fail_store_provision() returns trigger
        language plpgsql as $$ begin raise exception 'simulated provision crash'; end $$;
        create trigger test_fail_store_provision
        before insert on store_stores
        for each row execute function test_fail_store_provision();
      `);
      for (const [applicationId, token] of [
        [firstApplicationId, revokedToken],
        [secondApplicationId, activeToken],
      ] as const) {
        const response = await server.inject({
          method: "POST",
          url: `/v1/platform/seller-applications/${applicationId}/approval`,
          headers: {
            cookie: platformCookie(token),
            "idempotency-key": randomUUID(),
          },
          payload: {
            expectedRevision: 1,
            reasonCode: "ELIGIBILITY_CONFIRMED",
            publicReason: "شرایط فروشندگی شما تأیید شد.",
          },
        });
        expect(response.statusCode).toBe(500);
      }
      await revokeReviewPermission(revokedAgentId);
      await sql`drop trigger test_fail_store_provision on store_stores`;
      await sql`drop function test_fail_store_provision()`;

      const stopWorker = startSellerApprovalRecoveryPoller(
        {
          async nextPending() {
            const response = await server.inject({
              method: "GET",
              url: "/v1/internal/seller-approval-recoveries/pending",
              headers: {
                "x-sevo-worker-secret": environment.SELLER_APPROVAL_RECOVERY_SECRET,
              },
            });
            return response.json<{ recoveryId: string | null }>().recoveryId;
          },
          async recover(recoveryId) {
            const response = await server.inject({
              method: "POST",
              url: `/v1/internal/seller-approval-recoveries/${recoveryId}`,
              headers: {
                "x-sevo-worker-secret": environment.SELLER_APPROVAL_RECOVERY_SECRET,
              },
            });
            if (response.statusCode !== 204) {
              throw new Error(`Recovery endpoint returned ${response.statusCode}`);
            }
          },
        },
        1,
      );
      try {
        await waitUntil(async () => {
          const rows = await sql<Array<{ status: string; count: number }>>`
            select status, count(*)::int as count
            from identity_seller_approval_recoveries
            group by status
          `;
          return (
            rows.some((row) => row.status === "CANCELLED" && row.count === 1) &&
            rows.some((row) => row.status === "COMPLETED" && row.count === 1)
          );
        });
      } finally {
        await stopWorker();
      }

      const outcomes = await sql<
        Array<{
          applicationId: string;
          applicationStatus: string;
          recoveryStatus: string;
          deniedAuditCount: number;
        }>
      >`
        select a.id as "applicationId", a.status as "applicationStatus",
          r.status as "recoveryStatus",
          (select count(*)::int from identity_seller_application_audit au
           where au.target_id = a.id and au.action = 'ApproveSellerApplication.v1'
             and au.result = 'DENIED') as "deniedAuditCount"
        from identity_seller_applications a
        join identity_seller_approval_recoveries r on r.application_id = a.id
        where a.id in (${firstApplicationId}, ${secondApplicationId})
        order by a.id
      `;
      expect(outcomes).toEqual(
        expect.arrayContaining([
          {
            applicationId: firstApplicationId,
            applicationStatus: "SUBMITTED",
            recoveryStatus: "CANCELLED",
            deniedAuditCount: 1,
          },
          {
            applicationId: secondApplicationId,
            applicationStatus: "APPROVED",
            recoveryStatus: "COMPLETED",
            deniedAuditCount: 0,
          },
        ]),
      );
    } finally {
      await sql.unsafe(`
        drop trigger if exists test_fail_store_provision on store_stores;
        drop function if exists test_fail_store_provision();
      `);
      await sql.end();
    }
  });

  it("rolls back every approval effect when an approval outbox event cannot commit", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const applicantCookie = await signIn(app, "09123456786");
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { cookie: applicantCookie, "idempotency-key": randomUUID() },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;
    const applicantIdentityId = await identityIdForMobile("09123456786");
    await signIn(app, "09123456785");
    const agentIdentityId = await identityIdForMobile("09123456785");
    const token = await seedPlatformSession(agentIdentityId);
    await grantReviewPermission(agentIdentityId);
    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      await sql.unsafe(`
        create function test_fail_approval_outbox() returns trigger
        language plpgsql as $$
        begin
          if new.event_type = 'SellerApplicationApproved.v1' then
            raise exception 'simulated approval outbox failure';
          end if;
          return new;
        end $$;
        create trigger test_fail_approval_outbox
        before insert on platform_outbox_events
        for each row execute function test_fail_approval_outbox();
      `);
      const failed = await server.inject({
        method: "POST",
        url: `/v1/platform/seller-applications/${applicationId}/approval`,
        headers: {
          cookie: platformCookie(token),
          "idempotency-key": randomUUID(),
        },
        payload: {
          expectedRevision: 1,
          reasonCode: "ELIGIBILITY_CONFIRMED",
          publicReason: "شرایط فروشندگی شما تأیید شد.",
        },
      });
      expect(failed.statusCode).toBe(500);

      const state = await sql<
        Array<{
          status: string;
          accessCount: number;
          storeCount: number;
          decisionCount: number;
          succeededAuditCount: number;
          failedAuditCount: number;
          approvalEventCount: number;
        }>
      >`
        select a.status,
          (select count(*)::int from identity_seller_access
           where identity_id = ${applicantIdentityId}) as "accessCount",
          (select count(*)::int from store_memberships
           where seller_id = ${applicantIdentityId}) as "storeCount",
          (select count(*)::int from identity_seller_application_decisions
           where application_id = a.id and action = 'APPROVE') as "decisionCount",
          (select count(*)::int from identity_seller_application_audit
           where target_id = a.id and action = 'ApproveSellerApplication.v1'
             and result = 'SUCCEEDED') as "succeededAuditCount",
          (select count(*)::int from identity_seller_application_audit
           where target_id = a.id and action = 'ApproveSellerApplication.v1'
             and result = 'FAILED') as "failedAuditCount",
          (select count(*)::int from platform_outbox_events
           where event_type in ('SellerApplicationApproved.v1',
                                'SellerAccessActivated.v1')) as "approvalEventCount"
        from identity_seller_applications a where a.id = ${applicationId}
      `;
      expect(state).toEqual([
        {
          status: "SUBMITTED",
          accessCount: 0,
          storeCount: 0,
          decisionCount: 0,
          succeededAuditCount: 0,
          failedAuditCount: 1,
          approvalEventCount: 0,
        },
      ]);
    } finally {
      await sql.unsafe(`
        drop trigger if exists test_fail_approval_outbox on platform_outbox_events;
        drop function if exists test_fail_approval_outbox();
      `);
      await sql.end();
    }
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.restoreAllMocks();
  });

  it("creates a separate platform-agent session only after a live grant", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    await signIn(app, "09123456788");
    const identityId = await identityIdForMobile("09123456788");

    const denied = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/otp/requests",
      payload: { mobile: "09123456788" },
    });
    expect(denied.statusCode).toBe(403);

    await grantReviewPermission(identityId);
    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/otp/requests",
      payload: { mobile: "09123456788" },
    });
    expect(requested.statusCode).toBe(202);
    const verified = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/otp/verifications",
      payload: {
        challengeId: requested.json<{ challengeId: string }>().challengeId,
        code: "111111",
      },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      actor: { identityId, audience: "PLATFORM_AGENT" },
      permission: "SELLER_APPLICATION_REVIEW",
    });
    expect(verified.headers["set-cookie"]).toMatch(
      /^sevo_platform_session=.*Path=\/; HttpOnly; SameSite=Strict/,
    );
  });

  it("enrolls a bootstrap-authorized authenticator only after proving its code", async () => {
    const instant = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(instant);
    const app = await createApiApp({
      ...environment,
      PLATFORM_TOTP_ACTIVE_KEY_ID: "test-v1",
      PLATFORM_TOTP_KEYRING: { "test-v1": Buffer.alloc(32, 9).toString("base64") },
    });
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    await signIn(app, "09123456788");
    await signIn(app, "09123456787");
    const identityId = await identityIdForMobile("09123456788");
    const secondIdentityId = await identityIdForMobile("09123456787");
    const requestedBeforeBootstrap = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/otp/requests",
      payload: { mobile: "09123456788" },
    });
    expect(requestedBeforeBootstrap.statusCode).toBe(403);
    execFileSync(
      process.execPath,
      [
        "scripts/bootstrap-platform-totp.mjs",
        "--first",
        identityId,
        "--second",
        secondIdentityId,
        "--reason",
        "Independent identity checks completed",
      ],
      { env: { ...process.env, DATABASE_URL: environment.DATABASE_URL } },
    );
    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/otp/requests",
      payload: { mobile: "09123456788" },
    });
    const verified = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/otp/verifications",
      payload: {
        challengeId: requested.json<{ challengeId: string }>().challengeId,
        code: "111111",
      },
    });
    const cookie = String(verified.headers["set-cookie"]).split(";")[0];
    const headers = { cookie };
    const started = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/totp/enrollment",
      headers,
    });
    expect(started.statusCode).toBe(201);
    expect(started.headers["cache-control"]).toBe("no-store");
    const secret = started.json<{ secret: string }>().secret;
    const atRest = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      const rows = await atRest<{ ciphertext: Buffer; keyId: string }[]>`
        select ciphertext, key_id as "keyId" from identity_totp_factors where identity_id = ${identityId}`;
      expect(rows[0]?.keyId).toBe("test-v1");
      expect(rows[0]?.ciphertext.toString("utf8")).not.toContain(secret);
    } finally {
      await atRest.end();
    }
    const wrong = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/totp/enrollment/confirmation",
      headers,
      payload: { code: "abcdef" },
    });
    expect(wrong.statusCode).toBe(422);
    const realCode = testTotp(secret);
    const wrongCode = realCode === "000000" ? "000001" : "000000";
    const rejected = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/totp/enrollment/confirmation",
      headers,
      payload: { code: wrongCode },
    });
    expect(rejected.statusCode).toBe(403);
    const confirmed = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/totp/enrollment/confirmation",
      headers,
      payload: { code: testTotp(secret) },
    });
    expect(confirmed.statusCode).toBe(204);
    const replay = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/totp/enrollment/confirmation",
      headers,
      payload: { code: testTotp(secret) },
    });
    expect(replay.statusCode).toBe(403);
    const grant = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      await grant`insert into identity_platform_permission_grants (id, identity_id, permission, granted_at)
        values (${randomUUID()}, ${identityId}, 'SESSION_SECURITY', now())`;
    } finally {
      await grant.end();
    }
    const proofPayload = {
      code: testTotp(secret),
      action: "REVOKE_PUBLIC_SESSIONS",
      targetIdentityId: secondIdentityId,
      incidentId: "INC-100",
      reason: "نشست‌های مشکوک",
    };
    const replayProof = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/totp/proofs",
      headers,
      payload: proofPayload,
    });
    expect(replayProof.statusCode).toBe(403);
    const issueProof = () =>
      server.inject({
        method: "POST",
        url: "/v1/platform/auth/totp/proofs",
        headers,
        payload: { ...proofPayload, code: testTotp(secret, 1) },
      });
    const attempts = await Promise.all([issueProof(), issueProof()]);
    expect(attempts.map((item) => item.statusCode).sort()).toEqual([201, 403]);
    const proof = attempts.find((item) => item.statusCode === 201)!;
    expect(proof.json()).toMatchObject({
      proof: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(proof.headers["cache-control"]).toBe("no-store");
    const repeated = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/totp/enrollment",
      headers,
    });
    expect(repeated.statusCode).toBe(403);
  });

  it("fails closed when no TOTP encryption key is supplied", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const response = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/totp/enrollment",
    });
    expect(response.statusCode).toBe(503);
  });

  it("locks a platform OTP challenge after five incorrect attempts", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    await signIn(app, "09123456788");
    await grantReviewPermission(await identityIdForMobile("09123456788"));
    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/otp/requests",
      payload: { mobile: "09123456788" },
    });
    const challengeId = requested.json<{ challengeId: string }>().challengeId;
    for (let attempt = 0; attempt < 5; attempt++) {
      const rejected = await server.inject({
        method: "POST",
        url: "/v1/platform/auth/otp/verifications",
        payload: { challengeId, code: "222222" },
      });
      expect(rejected.statusCode).toBe(401);
    }
    const locked = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/otp/verifications",
      payload: { challengeId, code: "111111" },
    });
    expect(locked.statusCode).toBe(401);
  });

  it("lets a session-security-only agent sign in without review permissions", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    await signIn(app, "09123456788");
    const identityId = await identityIdForMobile("09123456788");
    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      await sql`insert into identity_platform_permission_grants
        (id, identity_id, permission, granted_at)
        values (${randomUUID()}, ${identityId}, 'SESSION_SECURITY', now())`;
    } finally {
      await sql.end();
    }
    const requested = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/otp/requests",
      payload: { mobile: "09123456788" },
    });
    expect(requested.statusCode).toBe(202);
    const verified = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/otp/verifications",
      payload: {
        challengeId: requested.json<{ challengeId: string }>().challengeId,
        code: "111111",
      },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().permission).toBe("SESSION_SECURITY");
    const cookie = String(verified.headers["set-cookie"]).split(";")[0];
    const review = await server.inject({
      method: "GET",
      url: "/v1/platform/seller-applications",
      headers: { cookie },
    });
    expect(review.statusCode).toBe(403);
  });

  it("reads every live workspace permission and invalidates the session on logout", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    await signIn(app, "09123456788");
    const identityId = await identityIdForMobile("09123456788");
    const token = await seedPlatformSession(identityId);
    const headers = { cookie: platformCookie(token) };

    const withoutPermission = await server.inject({
      method: "GET",
      url: "/v1/platform/auth/session",
      headers,
    });
    expect(withoutPermission.statusCode).toBe(200);
    expect(withoutPermission.json()).toMatchObject({
      actor: { identityId, audience: "PLATFORM_AGENT" },
      permissions: [],
    });

    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      await sql`
        insert into identity_platform_permission_grants
          (id, identity_id, permission, granted_at)
        values
          (${randomUUID()}, ${identityId}, 'PAYMENT_REVIEW', now()),
          (${randomUUID()}, ${identityId}, 'SELLER_APPLICATION_REVIEW', now())
      `;
    } finally {
      await sql.end();
    }

    const granted = await server.inject({
      method: "GET",
      url: "/v1/platform/auth/session",
      headers,
    });
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toMatchObject({
      permissions: ["PAYMENT_REVIEW", "SELLER_APPLICATION_REVIEW"],
    });

    await revokeReviewPermission(identityId);
    const revoked = await server.inject({
      method: "GET",
      url: "/v1/platform/auth/session",
      headers,
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ permissions: ["PAYMENT_REVIEW"] });

    const loggedOut = await server.inject({
      method: "POST",
      url: "/v1/platform/auth/logout",
      headers,
    });
    expect(loggedOut.statusCode).toBe(204);
    expect(loggedOut.headers["set-cookie"]).toContain(
      "sevo_platform_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
    );

    const ended = await server.inject({
      method: "GET",
      url: "/v1/platform/auth/session",
      headers,
    });
    expect(ended.statusCode).toBe(401);
  });

  it("lists a stable minimal queue only for a separately authorized agent", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const applicantCookie = await signIn(app, "09123456789");
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: {
        cookie: applicantCookie,
        "idempotency-key": randomUUID(),
      },
      payload: applicationPayload(),
    });
    expect(submitted.statusCode).toBe(201);
    const secondApplicantCookie = await signIn(app, "09123456787");
    const secondSubmitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: {
        cookie: secondApplicantCookie,
        "idempotency-key": randomUUID(),
      },
      payload: {
        ...applicationPayload(),
        applicantName: "سارا احمدی",
        proposedStoreName: "روایت چوب",
      },
    });
    expect(secondSubmitted.statusCode).toBe(201);

    const publicSession = await server.inject({
      method: "GET",
      url: "/v1/platform/seller-applications",
      headers: { cookie: applicantCookie },
    });
    expect(publicSession.statusCode).toBe(401);

    const agentIdentityCookie = await signIn(app, "09123456788");
    const agentIdentityId = await identityIdForMobile("09123456788");
    const ungrantedToken = await seedPlatformSession(agentIdentityId);
    const ungranted = await server.inject({
      method: "GET",
      url: "/v1/platform/seller-applications",
      headers: { cookie: platformCookie(ungrantedToken) },
    });
    expect(ungranted.statusCode).toBe(403);
    expect(ungranted.json()).toMatchObject({ code: "PLATFORM_PERMISSION_REQUIRED" });
    const deniedDetail = await server.inject({
      method: "GET",
      url: `/v1/platform/seller-applications/${submitted.json<{ applicationId: string }>().applicationId}`,
      headers: { cookie: platformCookie(ungrantedToken) },
    });
    expect(deniedDetail.statusCode).toBe(403);
    expect(JSON.stringify(deniedDetail.json())).not.toContain("09123456789");
    expect(agentIdentityCookie).toContain("sevo_session=");

    await grantReviewPermission(agentIdentityId);
    const listed = await server.inject({
      method: "GET",
      url: "/v1/platform/seller-applications?limit=1",
      headers: { cookie: platformCookie(ungrantedToken) },
    });
    expect(listed.statusCode).toBe(200);
    const firstPage = platformQueueResponse(listed.json());
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.items[0]).toMatchObject({ status: "SUBMITTED", revision: 1 });
    expect(Object.keys(firstPage.items[0]!).sort()).toEqual([
      "applicantName",
      "applicationId",
      "lastSubmittedAt",
      "maskedMobile",
      "proposedStoreName",
      "revision",
      "status",
    ]);
    expect(JSON.stringify(listed.json())).not.toMatch(
      /09123456789|09123456787|goodsAreaText|currentSalesMethod|internalNote/i,
    );

    const next = await server.inject({
      method: "GET",
      url: `/v1/platform/seller-applications?limit=1&cursor=${encodeURIComponent(
        firstPage.nextCursor!,
      )}`,
      headers: { cookie: platformCookie(ungrantedToken) },
    });
    expect(next.statusCode).toBe(200);
    const secondPage = platformQueueResponse(next.json());
    expect(secondPage.nextCursor).toBeNull();
    expect(
      new Set([firstPage.items[0]!.applicationId, secondPage.items[0]!.applicationId]),
    ).toEqual(
      new Set([
        submitted.json<{ applicationId: string }>().applicationId,
        secondSubmitted.json<{ applicationId: string }>().applicationId,
      ]),
    );

    await revokeReviewPermission(agentIdentityId);
    const revoked = await server.inject({
      method: "GET",
      url: "/v1/platform/seller-applications",
      headers: { cookie: platformCookie(ungrantedToken) },
    });
    expect(revoked.statusCode).toBe(403);
    expect(revoked.json()).toMatchObject({ code: "PLATFORM_PERMISSION_REQUIRED" });
  });

  it("audits a sensitive detail read with correlation and returns only review data", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const applicantCookie = await signIn(app, "09123456789");
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { cookie: applicantCookie, "idempotency-key": randomUUID() },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;

    await signIn(app, "09123456788");
    const agentIdentityId = await identityIdForMobile("09123456788");
    const token = await seedPlatformSession(agentIdentityId);
    await grantReviewPermission(agentIdentityId);
    const correlationId = randomUUID();
    const queue = await server.inject({
      method: "GET",
      url: "/v1/platform/seller-applications",
      headers: { cookie: platformCookie(token) },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({ items: [{ maskedMobile: "0912***6789" }] });
    expect(JSON.stringify(queue.json())).not.toContain("09123456789");
    const detail = await server.inject({
      method: "GET",
      url: `/v1/platform/seller-applications/${applicationId}`,
      headers: {
        cookie: platformCookie(token),
        "x-correlation-id": correlationId,
      },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      applicationId,
      isSelfReview: false,
      status: "SUBMITTED",
      revision: 1,
      payloadRevision: 1,
      currentPayload: applicationPayload(),
      decisions: [],
    });
    expect(detail.json()).not.toHaveProperty("identityId");
    expect(detail.json()).toHaveProperty("applicantMobile", "09123456789");

    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      const audits = await sql<
        Array<{
          id: string;
          actorIdentityId: string;
          audience: string;
          permission: string;
          action: string;
          correlationId: string;
        }>
      >`
        select id, actor_identity_id as "actorIdentityId", audience, permission,
          action, correlation_id as "correlationId"
        from identity_seller_application_audit
        where target_id = ${applicationId}
          and action = 'ReadSellerApplication.v1'
      `;
      expect(audits).toEqual([
        {
          id: expect.any(String),
          actorIdentityId: agentIdentityId,
          audience: "PLATFORM_AGENT",
          permission: "SELLER_APPLICATION_REVIEW",
          action: "ReadSellerApplication.v1",
          correlationId,
        },
      ]);
      await expect(
        sql`update identity_seller_application_audit set result = 'DENIED'
            where id = ${audits[0]!.id}`,
      ).rejects.toThrow("append-only");
      await expect(
        sql`delete from identity_seller_application_audit
            where id = ${audits[0]!.id}`,
      ).rejects.toThrow("append-only");
    } finally {
      await sql.end();
    }
  });

  it("requests information idempotently and gives the applicant a clear next step", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const applicantCookie = await signIn(app, "09123456789");
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { cookie: applicantCookie, "idempotency-key": randomUUID() },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;

    await signIn(app, "09123456788");
    const agentIdentityId = await identityIdForMobile("09123456788");
    const token = await seedPlatformSession(agentIdentityId);
    await grantReviewPermission(agentIdentityId);
    const correlationId = randomUUID();
    const key = randomUUID();
    const payload = {
      expectedRevision: 1,
      reasonCode: "INFORMATION_INCOMPLETE",
      publicReason: "لطفاً روش فعلی فروش را روشن‌تر توضیح دهید.",
      internalNote: "شرح مسیر ثبت سفارش کامل نیست.",
      requestedFields: ["currentSalesMethod"],
    };
    const headers = {
      cookie: platformCookie(token),
      "x-correlation-id": correlationId,
      "idempotency-key": key,
    };
    const decided = await server.inject({
      method: "POST",
      url: `/v1/platform/seller-applications/${applicationId}/information-request`,
      headers,
      payload,
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({
      applicationId,
      status: "NEEDS_INFORMATION",
      revision: 2,
      payloadRevision: 1,
      decisions: [
        {
          action: "REQUEST_INFORMATION",
          reasonCode: "INFORMATION_INCOMPLETE",
          publicReason: payload.publicReason,
          internalNote: payload.internalNote,
          requestedFields: payload.requestedFields,
          actorIdentityId: agentIdentityId,
          revision: 2,
        },
      ],
    });

    const replay = await server.inject({
      method: "POST",
      url: `/v1/platform/seller-applications/${applicationId}/information-request`,
      headers,
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(decided.json());

    const invalidTransition = await server.inject({
      method: "POST",
      url: `/v1/platform/seller-applications/${applicationId}/rejection`,
      headers: {
        cookie: platformCookie(token),
        "x-correlation-id": randomUUID(),
        "idempotency-key": randomUUID(),
      },
      payload: {
        expectedRevision: 2,
        reasonCode: "ELIGIBILITY_NOT_ESTABLISHED",
        publicReason: "با اطلاعات فعلی امکان تأیید فروشندگی وجود ندارد.",
      },
    });
    expect(invalidTransition.statusCode).toBe(409);
    expect(invalidTransition.json()).toMatchObject({
      code: "INVALID_APPLICATION_TRANSITION",
    });

    const mine = await server.inject({
      method: "GET",
      url: "/v1/seller-applications/mine",
      headers: { cookie: applicantCookie },
    });
    expect(mine.json()).toMatchObject({
      items: [
        {
          status: "NEEDS_INFORMATION",
          nextStep: "PROVIDE_INFORMATION",
          timeline: expect.arrayContaining([
            expect.objectContaining({
              status: "NEEDS_INFORMATION",
              publicReason: payload.publicReason,
              requestedFields: payload.requestedFields,
            }),
          ]),
        },
      ],
    });
    expect(JSON.stringify(mine.json())).not.toContain(payload.internalNote);

    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      const audits = await sql<Array<{ count: number; correlationId: string }>>`
        select count(*)::int as count, min(correlation_id::text) as "correlationId"
        from identity_seller_application_audit
        where target_id = ${applicationId}
          and action = 'RequestSellerApplicationInformation.v1'
      `;
      expect(audits).toEqual([{ count: 1, correlationId }]);
      const deniedAudits = await sql<Array<{ result: string }>>`
        select result from identity_seller_application_audit
        where target_id = ${applicationId}
          and action = 'RejectSellerApplication.v1'
      `;
      expect(deniedAudits).toEqual([{ result: "CONFLICT" }]);
      const events = await sql<Array<{ payload: unknown }>>`
        select payload from platform_outbox_events
        where aggregate_id = ${applicationId}
          and event_type = 'SellerApplicationInformationRequested.v1'
      `;
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events[0]?.payload)).not.toMatch(
        /نگار|خانه ماه|سفال|اینستاگرام|روشن‌تر|شرح مسیر/i,
      );
    } finally {
      await sql.end();
    }
  });

  it("denies self-review without changing the application and keeps the denial audit", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const applicantCookie = await signIn(app, "09123456789");
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { cookie: applicantCookie, "idempotency-key": randomUUID() },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;
    const identityId = await identityIdForMobile("09123456789");
    const token = await seedPlatformSession(identityId);
    await grantReviewPermission(identityId);
    const correlationId = randomUUID();

    const detail = await server.inject({
      method: "GET",
      url: `/v1/platform/seller-applications/${applicationId}`,
      headers: { cookie: platformCookie(token) },
    });
    expect(detail.json()).toMatchObject({ isSelfReview: true });
    expect(detail.json()).not.toHaveProperty("identityId");

    const denied = await server.inject({
      method: "POST",
      url: `/v1/platform/seller-applications/${applicationId}/information-request`,
      headers: {
        cookie: platformCookie(token),
        "x-correlation-id": correlationId,
        "idempotency-key": randomUUID(),
      },
      payload: {
        expectedRevision: 1,
        reasonCode: "INFORMATION_INCOMPLETE",
        publicReason: "لطفاً روش فعلی فروش را روشن‌تر توضیح دهید.",
        requestedFields: ["currentSalesMethod"],
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "SELF_REVIEW_FORBIDDEN" });
    const approvalDenied = await server.inject({
      method: "POST",
      url: `/v1/platform/seller-applications/${applicationId}/approval`,
      headers: {
        cookie: platformCookie(token),
        "idempotency-key": randomUUID(),
      },
      payload: {
        expectedRevision: 1,
        reasonCode: "ELIGIBILITY_CONFIRMED",
        publicReason: "شرایط فروشندگی شما تأیید شد.",
      },
    });
    expect(approvalDenied.statusCode).toBe(403);
    expect(approvalDenied.json()).toMatchObject({ code: "SELF_REVIEW_FORBIDDEN" });

    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      const applications = await sql<Array<{ status: string; revision: number }>>`
        select status, aggregate_version as revision
        from identity_seller_applications where id = ${applicationId}
      `;
      expect(applications).toEqual([{ status: "SUBMITTED", revision: 1 }]);
      const decisions = await sql<Array<{ count: number }>>`
        select count(*)::int as count from identity_seller_application_decisions
        where application_id = ${applicationId}
      `;
      expect(decisions[0]?.count).toBe(0);
      const audits = await sql<Array<{ result: string; correlationId: string }>>`
        select result, correlation_id::text as "correlationId"
        from identity_seller_application_audit
        where target_id = ${applicationId}
          and action = 'RequestSellerApplicationInformation.v1'
      `;
      expect(audits).toEqual([{ result: "DENIED", correlationId }]);
      const approvalAudits = await sql<Array<{ result: string }>>`
        select result from identity_seller_application_audit
        where target_id = ${applicationId}
          and action = 'ApproveSellerApplication.v1'
      `;
      expect(approvalAudits).toEqual([{ result: "DENIED" }]);
    } finally {
      await sql.end();
    }
  });

  it("lets only one of two concurrent reviewers transition the same revision", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const applicantCookie = await signIn(app, "09123456789");
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { cookie: applicantCookie, "idempotency-key": randomUUID() },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;

    await signIn(app, "09123456788");
    await signIn(app, "09123456787");
    const firstAgentId = await identityIdForMobile("09123456788");
    const secondAgentId = await identityIdForMobile("09123456787");
    const firstToken = await seedPlatformSession(firstAgentId);
    const secondToken = await seedPlatformSession(secondAgentId);
    await grantReviewPermission(firstAgentId);
    await grantReviewPermission(secondAgentId);

    const [information, rejection] = await Promise.all([
      server.inject({
        method: "POST",
        url: `/v1/platform/seller-applications/${applicationId}/information-request`,
        headers: {
          cookie: platformCookie(firstToken),
          "idempotency-key": randomUUID(),
        },
        payload: {
          expectedRevision: 1,
          reasonCode: "INFORMATION_INCOMPLETE",
          publicReason: "لطفاً روش فعلی فروش را روشن‌تر توضیح دهید.",
          requestedFields: ["currentSalesMethod"],
        },
      }),
      server.inject({
        method: "POST",
        url: `/v1/platform/seller-applications/${applicationId}/rejection`,
        headers: {
          cookie: platformCookie(secondToken),
          "idempotency-key": randomUUID(),
        },
        payload: {
          expectedRevision: 1,
          reasonCode: "ELIGIBILITY_NOT_ESTABLISHED",
          publicReason: "با اطلاعات فعلی امکان تأیید فروشندگی وجود ندارد.",
        },
      }),
    ]);

    expect([information.statusCode, rejection.statusCode].sort()).toEqual([200, 409]);
    const conflict = [information, rejection].find(
      (response) => response.statusCode === 409,
    )!;
    expect(conflict.json()).toMatchObject({
      code: "APPLICATION_REVISION_CONFLICT",
    });

    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      const state = await sql<
        Array<{
          revision: number;
          decisionCount: number;
          succeededAuditCount: number;
          conflictAuditCount: number;
        }>
      >`
        select a.aggregate_version as revision,
          (select count(*)::int from identity_seller_application_decisions d
           where d.application_id = a.id) as "decisionCount",
          (select count(*)::int from identity_seller_application_audit au
           where au.target_id = a.id and au.result = 'SUCCEEDED'
             and au.action in ('RequestSellerApplicationInformation.v1',
                               'RejectSellerApplication.v1')) as "succeededAuditCount",
          (select count(*)::int from identity_seller_application_audit au
           where au.target_id = a.id and au.result = 'CONFLICT'
             and au.action in ('RequestSellerApplicationInformation.v1',
                               'RejectSellerApplication.v1')) as "conflictAuditCount"
        from identity_seller_applications a where a.id = ${applicationId}
      `;
      expect(state).toEqual([
        {
          revision: 2,
          decisionCount: 1,
          succeededAuditCount: 1,
          conflictAuditCount: 1,
        },
      ]);
    } finally {
      await sql.end();
    }
  });

  it("rejects once with a human reason visible to the applicant", async () => {
    const app = await createApiApp(environment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const applicantCookie = await signIn(app, "09123456789");
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { cookie: applicantCookie, "idempotency-key": randomUUID() },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;
    await signIn(app, "09123456788");
    const agentId = await identityIdForMobile("09123456788");
    const token = await seedPlatformSession(agentId);
    await grantReviewPermission(agentId);
    const headers = {
      cookie: platformCookie(token),
      "idempotency-key": randomUUID(),
    };
    const payload = {
      expectedRevision: 1,
      reasonCode: "ELIGIBILITY_NOT_ESTABLISHED",
      publicReason: "با اطلاعات فعلی امکان تأیید فروشندگی وجود ندارد.",
      internalNote: "اطلاعات موجود برای احراز شرایط کافی نیست.",
    };

    const rejected = await server.inject({
      method: "POST",
      url: `/v1/platform/seller-applications/${applicationId}/rejection`,
      headers,
      payload,
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      status: "REJECTED",
      revision: 2,
      decisions: [
        {
          action: "REJECT",
          publicReason: payload.publicReason,
          internalNote: payload.internalNote,
        },
      ],
    });
    const replay = await server.inject({
      method: "POST",
      url: `/v1/platform/seller-applications/${applicationId}/rejection`,
      headers,
      payload,
    });
    expect(replay.json()).toEqual(rejected.json());

    const mine = await server.inject({
      method: "GET",
      url: "/v1/seller-applications/mine",
      headers: { cookie: applicantCookie },
    });
    expect(mine.json()).toMatchObject({
      items: [
        {
          status: "REJECTED",
          nextStep: "APPLICATION_ENDED",
          timeline: expect.arrayContaining([
            expect.objectContaining({ publicReason: payload.publicReason }),
          ]),
        },
      ],
    });
    expect(JSON.stringify(mine.json())).not.toContain(payload.internalNote);
  });

  async function signIn(app: Awaited<ReturnType<typeof createApiApp>>, mobile: string) {
    const server = app.getHttpAdapter().getInstance();
    const requested = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile },
    });
    const verified = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: {
        challengeId: requested.json<{ challengeId: string }>().challengeId,
        code: "111111",
      },
    });
    return verified.headers["set-cookie"]!;
  }

  async function identityIdForMobile(mobile: string) {
    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      const rows = await sql<Array<{ identityId: string }>>`
        select identity_id as "identityId" from identity_login_methods
        where mobile = ${mobile}
      `;
      return rows[0]!.identityId;
    } finally {
      await sql.end();
    }
  }

  async function seedPlatformSession(identityId: string) {
    const token = randomBytes(32).toString("base64url");
    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      await sql`
        insert into identity_sessions
          (id, token_hash, identity_id, audience, expires_at)
        values
          (${randomUUID()}, ${hash(token)}, ${identityId}, 'PLATFORM_AGENT',
           now() + interval '1 hour')
      `;
    } finally {
      await sql.end();
    }
    return token;
  }

  async function grantReviewPermission(identityId: string) {
    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      await sql`
        insert into identity_platform_permission_grants
          (id, identity_id, permission, granted_at)
        values
          (${randomUUID()}, ${identityId}, 'SELLER_APPLICATION_REVIEW', now())
      `;
    } finally {
      await sql.end();
    }
  }

  async function revokeReviewPermission(identityId: string) {
    const sql = postgres(environment.DATABASE_URL, { max: 1 });
    try {
      await sql`
        update identity_platform_permission_grants
        set revoked_at = now()
        where identity_id = ${identityId}
          and permission = 'SELLER_APPLICATION_REVIEW'
          and revoked_at is null
      `;
    } finally {
      await sql.end();
    }
  }
});

function platformCookie(token: string) {
  return `sevo_platform_session=${token}`;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function applicationPayload() {
  return {
    applicantName: "نگار محمدی",
    proposedStoreName: "خانه ماه",
    goodsAreaText: "سفال دست‌ساز",
    currentSalesMethod: "فروش از راه اینستاگرام و پیام مستقیم",
  };
}

function platformQueueResponse(value: unknown) {
  return value as {
    items: Array<{
      applicationId: string;
      applicantName: string;
      proposedStoreName: string;
      status: string;
      revision: number;
      lastSubmittedAt: string;
    }>;
    nextCursor: string | null;
  };
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function testTotp(secret: string, counterOffset = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret)
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((part) => Number.parseInt(part, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + counterOffset));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[19]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
