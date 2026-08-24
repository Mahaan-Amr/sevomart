import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { iranianMobileContract } from "@sevo/contracts/identity-access/v1";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("seller application applicant API with PostgreSQL", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from identity_seller_access`;
    await sql`delete from identity_seller_application_idempotency`;
    await sql`delete from identity_seller_application_audit`;
    await sql`delete from identity_seller_application_decisions`;
    await sql`delete from identity_seller_application_revisions`;
    await sql`delete from identity_seller_applications`;
    await sql`delete from platform_outbox_events where event_type like 'SellerApplication%'`;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function startApp(environment = apiTestEnvironment) {
    const app = await createApiApp(environment);
    apps.push(app);
    return app;
  }

  async function signIn(
    app: Awaited<ReturnType<typeof startApp>>,
    mobile = "09123456789",
  ) {
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

  it("submits once, replays a duplicate and exposes only the applicant-safe view", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const payload = {
      applicantName: "نگار محمدی",
      proposedStoreName: "خانه ماه",
      goodsAreaText: "سفال دست‌ساز",
      currentSalesMethod: "فروش از راه اینستاگرام و پیام مستقیم",
    };
    const headers = {
      cookie,
      "idempotency-key": "74155020-2830-43a5-9bc1-d5bb7a7fead8",
    };

    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers,
      payload,
    });
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json()).toMatchObject({
      status: "SUBMITTED",
      currentRevision: 1,
      currentPayload: payload,
      nextStep: "WAIT_FOR_REVIEW",
    });

    const replayed = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers,
      payload,
    });
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json()).toEqual(submitted.json());

    const readMine = await server.inject({
      method: "GET",
      url: "/v1/seller-applications/mine",
      headers: { cookie },
    });
    expect(readMine.statusCode).toBe(200);
    expect(readMine.json()).toEqual({ items: [submitted.json()], nextCursor: null });

    const inspect = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      const events = await inspect<
        Array<{ payload: unknown; aggregateVersion: number }>
      >`
        select payload, aggregate_version as "aggregateVersion"
        from platform_outbox_events
        where event_type = 'SellerApplicationSubmitted.v1'
      `;
      expect(events).toHaveLength(1);
      expect(events[0]?.aggregateVersion).toBe(1);
      expect(JSON.stringify(events[0]?.payload)).not.toMatch(
        /نگار|خانه ماه|سفال|اینستاگرام|Reason/i,
      );
    } finally {
      await inspect.end();
    }
  });

  it("requires an identity session and keeps another identity outside the application", async () => {
    const app = await startApp({
      ...apiTestEnvironment,
      DEV_OTP_TEST_MOBILES: ["09123456789", "09123456788"].map((mobile) =>
        iranianMobileContract.parse(mobile),
      ),
    });
    const server = app.getHttpAdapter().getInstance();
    const unauthorized = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { "idempotency-key": "94b64e42-dc5d-44f7-b7df-850735ec17ea" },
      payload: applicationPayload(),
    });
    expect(unauthorized.statusCode).toBe(401);

    const ownerCookie = await signIn(app);
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: {
        cookie: ownerCookie,
        "idempotency-key": "94b64e42-dc5d-44f7-b7df-850735ec17ea",
      },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;

    const otherCookie = await signIn(app, "09123456788");
    const otherHistory = await server.inject({
      method: "GET",
      url: "/v1/seller-applications/mine",
      headers: { cookie: otherCookie },
    });
    expect(otherHistory.json()).toEqual({ items: [], nextCursor: null });

    const otherMutation = await server.inject({
      method: "POST",
      url: `/v1/seller-applications/${applicationId}/resubmission`,
      headers: {
        cookie: otherCookie,
        "idempotency-key": "f96c3cc9-0bf1-46b1-bfca-b241330f06c7",
      },
      payload: { ...applicationPayload(), expectedRevision: 1 },
    });
    expect(otherMutation.statusCode).toBe(404);
    expect(otherMutation.json()).toMatchObject({ code: "APPLICATION_NOT_FOUND" });
  });

  it("rejects conflicting duplicates and a second active application", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const key = "197e28fa-0c29-4e90-aa4a-7663837e2228";
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { cookie, "idempotency-key": key },
      payload: applicationPayload(),
    });
    expect(submitted.statusCode).toBe(201);

    const conflictingReplay = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: { cookie, "idempotency-key": key },
      payload: { ...applicationPayload(), proposedStoreName: "نام متفاوت" },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const secondActive = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: {
        cookie,
        "idempotency-key": "f50b8fa6-f7d6-4ac9-a18c-6d699d67d172",
      },
      payload: applicationPayload(),
    });
    expect(secondActive.statusCode).toBe(409);
    expect(secondActive.json()).toMatchObject({ code: "ACTIVE_APPLICATION_EXISTS" });
  });

  it("rejects an identity that already has seller access", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      const identities = await sql<Array<{ identityId: string }>>`
        select identity_id as "identityId" from identity_login_methods
        where mobile = '09123456789'
      `;
      await sql`
        insert into identity_seller_access (id, identity_id, status, created_at)
        values (${crypto.randomUUID()}, ${identities[0]!.identityId}, 'SUSPENDED', now())
      `;
    } finally {
      await sql.end();
    }

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/v1/seller-applications",
        headers: {
          cookie,
          "idempotency-key": "47fb2e6d-095e-4911-8a8b-fea1dd105d03",
        },
        payload: applicationPayload(),
      });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "SELLER_ALREADY_ACTIVE" });
  });

  it("returns Retry-After while the same idempotent command is in progress", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const key = "7bf40a67-9034-4780-bfdf-7523d128f9b4";
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const identities = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId" from identity_login_methods
      where mobile = '09123456789'
    `;
    const lockKey = `SubmitSellerApplication.v1:${identities[0]!.identityId}:${key}`;
    try {
      await sql.begin(async (transaction) => {
        await transaction`
          select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        `;
        const response = await app
          .getHttpAdapter()
          .getInstance()
          .inject({
            method: "POST",
            url: "/v1/seller-applications",
            headers: { cookie, "idempotency-key": key },
            payload: applicationPayload(),
          });
        expect(response.statusCode).toBe(409);
        expect(response.headers["retry-after"]).toBe("1");
        expect(response.json()).toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
      });
    } finally {
      await sql.end();
    }
  });

  it("resubmits only a requested-information revision and preserves its public timeline", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: {
        cookie,
        "idempotency-key": "b71f71fe-8b0e-4603-ae1b-d6b4effc1368",
      },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;

    const invalidTransition = await server.inject({
      method: "POST",
      url: `/v1/seller-applications/${applicationId}/resubmission`,
      headers: {
        cookie,
        "idempotency-key": "70bcb797-76dc-484f-98a9-4d2e7698a273",
      },
      payload: { ...applicationPayload(), expectedRevision: 1 },
    });
    expect(invalidTransition.statusCode).toBe(409);
    expect(invalidTransition.json()).toMatchObject({
      code: "INVALID_APPLICATION_TRANSITION",
    });

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql.begin(async (transaction) => {
        await transaction`
          update identity_seller_applications
          set status = 'NEEDS_INFORMATION'
          where id = ${applicationId}
        `;
        await transaction`
          insert into identity_seller_application_decisions
            (id, application_id, revision, action, reason_code, public_reason,
             requested_fields, actor_identity_id, occurred_at)
          values
            ('1aba8d31-21df-4d2a-8be0-3df6ec16f51d', ${applicationId}, 1,
             'REQUEST_INFORMATION', 'INFORMATION_INCOMPLETE',
             'لطفاً روش فعلی فروش را روشن‌تر بنویسید.',
             ARRAY['currentSalesMethod'],
             '9921f18f-187f-40dd-a389-1626156366f8', now())
        `;
      });
    } finally {
      await sql.end();
    }

    const replacement = {
      ...applicationPayload(),
      proposedStoreName: "خانه ماه نو",
      currentSalesMethod: "فروش از راه اینستاگرام با ثبت سفارش در پیام مستقیم",
      expectedRevision: 1,
    };
    const headers = {
      cookie,
      "idempotency-key": "7ff13fcb-1dcf-4ed5-b188-5f43e9bb236b",
    };
    const resubmitted = await server.inject({
      method: "POST",
      url: `/v1/seller-applications/${applicationId}/resubmission`,
      headers,
      payload: replacement,
    });
    expect(resubmitted.statusCode).toBe(200);
    expect(resubmitted.json()).toMatchObject({
      status: "SUBMITTED",
      currentRevision: 2,
      currentPayload: {
        ...applicationPayload(),
        proposedStoreName: "خانه ماه نو",
        currentSalesMethod: "فروش از راه اینستاگرام با ثبت سفارش در پیام مستقیم",
      },
      timeline: [
        { revision: 1, status: "SUBMITTED", title: "درخواست ثبت شد" },
        {
          revision: 1,
          status: "NEEDS_INFORMATION",
          publicReason: "لطفاً روش فعلی فروش را روشن‌تر بنویسید.",
          requestedFields: ["currentSalesMethod"],
        },
        { revision: 2, status: "SUBMITTED", title: "اطلاعات تکمیل شد" },
      ],
    });

    const replay = await server.inject({
      method: "POST",
      url: `/v1/seller-applications/${applicationId}/resubmission`,
      headers,
      payload: replacement,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(resubmitted.json());
  });

  it("shows the applicant a public decision reason without the internal note", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: {
        cookie,
        "idempotency-key": "19059c3f-2605-44fc-ae77-c9add9db48b6",
      },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql.begin(async (transaction) => {
        await transaction`
          update identity_seller_applications
          set status = 'REJECTED', completed_at = now()
          where id = ${applicationId}
        `;
        await transaction`
          insert into identity_seller_application_decisions
            (id, application_id, revision, action, reason_code, public_reason,
             internal_note, requested_fields, actor_identity_id, occurred_at)
          values
            ('ad57f73f-cb39-40ab-9296-93539cc5a0de', ${applicationId}, 1,
             'REJECT', 'ELIGIBILITY_NOT_ESTABLISHED',
             'با اطلاعات فعلی امکان تأیید فروشندگی وجود ندارد.',
             'یادداشت محرمانه عامل پلتفرم', ARRAY[]::text[],
             '9921f18f-187f-40dd-a389-1626156366f8', now())
        `;
      });
    } finally {
      await sql.end();
    }

    const history = await server.inject({
      method: "GET",
      url: "/v1/seller-applications/mine",
      headers: { cookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      items: [
        {
          status: "REJECTED",
          nextStep: "APPLICATION_ENDED",
          timeline: [
            { title: "درخواست ثبت شد" },
            {
              title: "درخواست تأیید نشد",
              publicReason: "با اطلاعات فعلی امکان تأیید فروشندگی وجود ندارد.",
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(history.json())).not.toContain("یادداشت محرمانه عامل پلتفرم");
  });

  it("withdraws an active application idempotently and emits no applicant data", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/seller-applications",
      headers: {
        cookie,
        "idempotency-key": "635535ce-e921-4249-a322-b2cbd57ac8e7",
      },
      payload: applicationPayload(),
    });
    const applicationId = submitted.json<{ applicationId: string }>().applicationId;
    const headers = {
      cookie,
      "idempotency-key": "03869a09-79d0-4ea8-bcda-0c66248b489f",
    };
    const payload = { expectedRevision: 1 };

    const withdrawn = await server.inject({
      method: "POST",
      url: `/v1/seller-applications/${applicationId}/withdrawal`,
      headers,
      payload,
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json()).toMatchObject({
      status: "WITHDRAWN",
      nextStep: "APPLICATION_ENDED",
      timeline: expect.arrayContaining([
        expect.objectContaining({
          status: "WITHDRAWN",
          publicReason: "درخواست به خواست متقاضی پس گرفته شد.",
        }),
      ]),
    });

    const replay = await server.inject({
      method: "POST",
      url: `/v1/seller-applications/${applicationId}/withdrawal`,
      headers,
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(withdrawn.json());

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      const events = await sql<Array<{ aggregateVersion: number; payload: unknown }>>`
        select aggregate_version as "aggregateVersion", payload
        from platform_outbox_events
        where event_type = 'SellerApplicationWithdrawn.v1'
      `;
      expect(events).toHaveLength(1);
      expect(events[0]?.aggregateVersion).toBe(2);
      expect(JSON.stringify(events[0]?.payload)).not.toMatch(
        /نگار|خانه ماه|سفال|اینستاگرام/i,
      );
    } finally {
      await sql.end();
    }
  });

  it("rejects invalid history cursors through the HTTP contract", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/v1/seller-applications/mine?cursor=not-a-cursor&limit=1",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "INVALID_CURSOR" });
  });
});

function applicationPayload() {
  return {
    applicantName: "نگار محمدی",
    proposedStoreName: "خانه ماه",
    goodsAreaText: "سفال دست‌ساز",
    currentSalesMethod: "فروش از راه اینستاگرام و پیام مستقیم",
  };
}
