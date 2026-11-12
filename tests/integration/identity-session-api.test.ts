import {
  identitySessionContract,
  iranianMobileContract,
} from "@sevo/contracts/identity-access/v1";
import postgres from "postgres";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { createActiveSellerFixture } from "../../apps/api/src/modules/identity-access/testing/active-seller.fixture";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("identity session HTTP API with PostgreSQL", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from identity_otp_challenges`;
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

  it("normalizes Persian mobile and Arabic OTP before validation and storage", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();
    const challenge = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "۰۹۱۲۳۴۵۶۷۸۹" },
    });
    expect(challenge.statusCode).toBe(202);
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      const rows =
        await sql`select mobile from identity_otp_challenges where id = ${challenge.json().challengeId}::uuid`;
      expect(rows[0]?.mobile).toBe("09123456789");
      const verified = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: challenge.json().challengeId, code: "١١١١١١" },
      });
      expect(verified.statusCode).toBe(200);
      const methods =
        await sql`select mobile from identity_login_methods where identity_id = ${verified.json().actor.identityId}::uuid`;
      expect(methods[0]?.mobile).toBe("09123456789");
    } finally {
      await sql.end();
    }
  });

  it.each([
    ["GET", "/v1/auth/session", "row", "idle"],
    ["GET", "/v1/me/feeds/following", "row", "idle"],
    ["DELETE", "/v1/auth/sessions", "identity", "idle"],
    ["DELETE", "/v1/auth/sessions", "row", "idle"],
    ["GET", "/v1/auth/session", "row", "absolute"],
    ["DELETE", "/v1/auth/sessions", "identity", "absolute"],
  ] as const)(
    "rejects %s %s when %s lock waits past %s expiry",
    async (method, url, lock, deadline) => {
      const app = await startApp();
      const server = app.getHttpAdapter().getInstance();
      const challenge = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: "09123456789" },
      });
      const verified = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: challenge.json().challengeId, code: "111111" },
      });
      const cookie = String(verified.headers["set-cookie"]);
      const token = cookie.match(/sevo_session=([^;]+)/)![1]!;
      const hash = createHash("sha256").update(token).digest("hex");
      const identityId = verified.json().actor.identityId;
      const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 3 });
      let release!: () => void;
      let acquired!: () => void;
      const held = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        if (deadline === "idle") {
          await sql`update identity_sessions set expires_at = clock_timestamp() + interval '3 seconds' where token_hash = ${hash}`;
        } else {
          await sql`update identity_sessions set created_at = clock_timestamp() - interval '90 days' + interval '3 seconds', expires_at = clock_timestamp() + interval '1 day' where token_hash = ${hash}`;
        }
        const holder = sql.begin(async (tx) => {
          if (lock === "row")
            await tx`select id from identity_sessions where token_hash = ${hash} for update`;
          else
            await tx`select pg_advisory_xact_lock(hashtextextended(${identityId}, 273))`;
          acquired();
          await gate;
        });
        await held;
        const request = server.inject({ method, url, headers: { cookie } });
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await sql<
            Array<{ blocked: boolean }>
          >`select exists(select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()) as blocked`;
          if (rows[0]?.blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        await sql`select pg_sleep(greatest(0, extract(epoch from (select least(expires_at, created_at + interval '90 days') from identity_sessions where token_hash = ${hash}) - clock_timestamp()) + 0.1))`;
        release();
        await holder;
        expect((await request).statusCode).toBe(401);
      } finally {
        release();
        await sql.end();
      }
    },
  );

  it("logs out all public sessions of the current identity", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();
    async function login(mobile: string) {
      const challenge = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile },
      });
      return server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: challenge.json().challengeId, code: "111111" },
      });
    }
    const first = await login("09123456789");
    const second = await login("09123456789");
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql`update identity_identities set status = 'INACTIVE' where id = ${first.json().actor.identityId}`;
      const denied = await server.inject({
        method: "DELETE",
        url: "/v1/auth/sessions",
        headers: { cookie: first.headers["set-cookie"] },
      });
      expect(denied.statusCode).toBe(401);
    } finally {
      await sql`update identity_identities set status = 'ACTIVE' where id = ${first.json().actor.identityId}`;
      await sql.end();
    }
    const result = await server.inject({
      method: "DELETE",
      url: "/v1/auth/sessions",
      headers: { cookie: first.headers["set-cookie"] },
    });
    expect(result.statusCode).toBe(204);
    const check = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: second.headers["set-cookie"] },
    });
    expect(check.statusCode).toBe(401);
  });

  it("preserves the platform session when all public sessions are ended", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();
    const challenge = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "09123456789" },
    });
    const verified = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId: challenge.json().challengeId, code: "111111" },
    });
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql`insert into identity_sessions (id, token_hash, identity_id, audience, expires_at) values (${randomUUID()}, ${hash}, ${verified.json().actor.identityId}, 'PLATFORM_AGENT', now() + interval '1 hour')`;
      const platformHeaders = { cookie: `sevo_platform_session=${token}` };
      expect(
        (
          await server.inject({
            method: "GET",
            url: "/v1/platform/auth/session",
            headers: platformHeaders,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await server.inject({
            method: "DELETE",
            url: "/v1/auth/sessions",
            headers: { cookie: verified.headers["set-cookie"] },
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await server.inject({
            method: "GET",
            url: "/v1/platform/auth/session",
            headers: platformHeaders,
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await sql`delete from identity_sessions where token_hash = ${hash}`;
      await sql.end();
    }
  });

  it("serializes a new public login after an in-flight logout of all devices", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();
    async function requestChallenge() {
      return server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: "09123456789" },
      });
    }
    async function verify(challengeId: string) {
      return server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId, code: "111111" },
      });
    }
    const first = await verify((await requestChallenge()).json().challengeId);
    const nextChallenge = await requestChallenge();
    const identityId = first.json().actor.identityId;
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 2 });
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const holder = sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${identityId}, 273))`;
        acquired();
        await gate;
      });
      await held;
      async function waitForBlocked(count: number) {
        for (let attempt = 0; attempt < 150; attempt++) {
          const [row] = await sql<
            Array<{ count: number }>
          >`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event = 'advisory' and pid <> pg_backend_pid()`;
          if ((row?.count ?? 0) >= count) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`Expected ${count} advisory lock waiters`);
      }
      const logout = server.inject({
        method: "DELETE",
        url: "/v1/auth/sessions",
        headers: { cookie: first.headers["set-cookie"] },
      });
      await waitForBlocked(1);
      const login = verify(nextChallenge.json().challengeId);
      await waitForBlocked(2);
      release();
      await holder;
      expect((await logout).statusCode).toBe(204);
      const next = await login;
      expect(next.statusCode).toBe(200);
      expect(
        (
          await server.inject({
            method: "GET",
            url: "/v1/auth/session",
            headers: { cookie: first.headers["set-cookie"] },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await server.inject({
            method: "GET",
            url: "/v1/auth/session",
            headers: { cookie: next.headers["set-cookie"] },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      release();
      await sql.end();
    }
  });

  it("extends an active session after activity", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();
    const challenge = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "09123456789" },
    });
    const verified = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId: challenge.json().challengeId, code: "111111" },
    });
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql`update identity_sessions set expires_at = now() + interval '1 day' where identity_id = ${verified.json().actor.identityId} and audience = 'PUBLIC'`;
      const response = await server.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: verified.headers["set-cookie"] },
      });
      expect(response.statusCode).toBe(200);
      expect(Date.parse(response.json().expiresAt)).toBeGreaterThan(
        Date.now() + 6 * 86400000,
      );
      await sql`update identity_sessions set created_at = now() - interval '91 days', expires_at = now() + interval '1 day' where identity_id = ${verified.json().actor.identityId} and audience = 'PUBLIC'`;
      const expired = await server.inject({
        method: "GET",
        url: "/v1/me/feeds/following",
        headers: { cookie: verified.headers["set-cookie"] },
      });
      expect(expired.statusCode).toBe(401);
    } finally {
      await sql.end();
    }
  });

  it("does not restore a session when activity races with logout", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();
    const challenge = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "09123456789" },
    });
    const verified = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId: challenge.json().challengeId, code: "111111" },
    });
    const headers = { cookie: verified.headers["set-cookie"] };
    const [, logout] = await Promise.all([
      server.inject({ method: "GET", url: "/v1/auth/session", headers }),
      server.inject({ method: "DELETE", url: "/v1/auth/session", headers }),
    ]);
    expect(logout.statusCode).toBe(204);
    const after = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers,
    });
    expect(after.statusCode).toBe(401);
  });

  it("denies seller access after revocation while keeping the buyer session", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();
    const challenge = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "09123456789" },
    });
    const verified = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId: challenge.json().challengeId, code: "111111" },
    });
    const identityId = verified.json().actor.identityId;
    const seller = await createActiveSellerFixture(
      apiTestEnvironment.DATABASE_URL,
      identityId,
    );
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const headers = { cookie: verified.headers["set-cookie"] };
    try {
      expect(
        (await server.inject({ method: "GET", url: "/v1/seller/orders", headers }))
          .statusCode,
      ).not.toBe(403);
      await sql`update identity_seller_access set status = 'REVOKED' where identity_id = ${identityId}`;
      expect(
        (await server.inject({ method: "GET", url: "/v1/seller/orders", headers }))
          .statusCode,
      ).toBe(403);
      expect(
        (await server.inject({ method: "GET", url: "/v1/auth/session", headers }))
          .statusCode,
      ).toBe(200);
    } finally {
      await seller.cleanup();
      await sql.end();
    }
  });

  it("keeps the development OTP adapter in optimized local images", async () => {
    const app = await startApp({
      ...apiTestEnvironment,
      NODE_ENV: "production",
      SEVO_RUNTIME_ENV: "development",
    });
    const requestResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: "09123456789" },
      });

    expect(requestResponse.statusCode).toBe(202);
    const verifyResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: {
          challengeId: requestResponse.json<{ challengeId: string }>().challengeId,
          code: "111111",
        },
      });

    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.headers["set-cookie"]).not.toContain("; Secure");
  });

  it("does not reveal whether a valid mobile can receive the development OTP", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "09120000000" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      challengeId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      expiresAt: expect.any(String),
    });

    const verification = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: {
        challengeId: response.json<{ challengeId: string }>().challengeId,
        code: "111111",
      },
    });
    expect(verification.statusCode).toBe(401);
    expect(verification.headers["set-cookie"]).toBeUndefined();
  });

  it("rate limits repeated OTP requests without changing the public response shape", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();

    const responses = await Promise.all(
      Array.from({ length: 25 }, () =>
        server.inject({
          method: "POST",
          url: "/v1/auth/otp/requests",
          payload: { mobile: "09120000001" },
        }),
      ),
    );
    expect(responses.filter(({ statusCode }) => statusCode === 202)).toHaveLength(20);
    expect(responses.filter(({ statusCode }) => statusCode === 429)).toHaveLength(5);
    const limited = responses.find(({ statusCode }) => statusCode === 429)!;
    expect(limited.json()).toMatchObject({
      code: "RATE_LIMITED",
      message: "درخواست‌ها زیاد شده است؛ کمی بعد دوباره تلاش کنید.",
    });
    expect(JSON.stringify(limited.json())).not.toContain("09120000001");
  });

  it("shares OTP request limits across digit scripts and rejects malformed numbers", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();
    const invalid = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "۰۹۱۲۳۴۵۶۷۸x" },
    });
    expect(invalid.statusCode).toBe(422);
    const spellings = ["09120000001", "۰۹۱۲۰۰۰۰۰۰۱", "٠٩١٢٠٠٠٠٠٠١"];
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: spellings[attempt % spellings.length] },
      });
      expect(result.statusCode).toBe(202);
    }
    const limited = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: spellings[2] },
    });
    expect(limited.statusCode).toBe(429);
    expect(JSON.stringify(limited.json())).not.toMatch(
      /09120000001|۰۹۱۲۰۰۰۰۰۰۱|٠٩١٢٠٠٠٠٠٠١/,
    );
  });

  it("locks a challenge after wrong codes in mixed scripts and rejects malformed codes", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();
    const requested = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "۰۹۱۲۳۴۵۶۷۸۹" },
    });
    expect(requested.statusCode).toBe(202);
    const challengeId = requested.json<{ challengeId: string }>().challengeId;
    const malformed = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId, code: "۲۲۲۲۲x" },
    });
    expect(malformed.statusCode).toBe(422);
    for (const code of ["222222", "۲۲۲۲۲۲", "٢٢٢٢٢٢", "۲۲۲۲۲۲", "222222"]) {
      const rejected = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId, code },
      });
      expect(rejected.statusCode).toBe(401);
    }
    const locked = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId, code: "۱۱۱۱۱۱" },
    });
    expect(locked.statusCode).toBe(401);
    expect(locked.headers["set-cookie"]).toBeUndefined();
  });

  it("locks an OTP challenge after five incorrect verification attempts", async () => {
    const app = await startApp();
    const server = app.getHttpAdapter().getInstance();
    const requested = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "09123456789" },
    });
    const challengeId = requested.json<{ challengeId: string }>().challengeId;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejected = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId, code: "222222" },
      });
      expect(rejected.statusCode).toBe(401);
    }

    const locked = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId, code: "111111" },
    });
    expect(locked.statusCode).toBe(401);
    expect(locked.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects expired OTP challenges and expired identity sessions", async () => {
    const app = await startApp({
      ...apiTestEnvironment,
      DEV_OTP_TEST_MOBILES: [
        iranianMobileContract.parse("09123456788"),
        iranianMobileContract.parse("09123456787"),
      ],
    });
    const server = app.getHttpAdapter().getInstance();
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      const expiringChallenge = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: "09123456788" },
      });
      const expiredChallengeId = expiringChallenge.json<{ challengeId: string }>()
        .challengeId;
      await sql`
        update identity_otp_challenges
        set expires_at = now() - interval '1 second'
        where id = ${expiredChallengeId}
      `;
      const expiredVerification = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: expiredChallengeId, code: "111111" },
      });
      expect(expiredVerification.statusCode).toBe(401);

      const sessionChallenge = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: "09123456787" },
      });
      const verified = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: {
          challengeId: sessionChallenge.json<{ challengeId: string }>().challengeId,
          code: "111111",
        },
      });
      const session = identitySessionContract.parse(verified.json());
      await sql`
        update identity_sessions
        set expires_at = now() - interval '1 second'
        where identity_id = ${session.actor.identityId}
      `;
      const expiredSession = await server.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: verified.headers["set-cookie"] },
      });
      expect(expiredSession.statusCode).toBe(401);
    } finally {
      await sql.end();
    }
  });

  it("persists a challenge across an app restart and creates a canonical identity session", async () => {
    const requestingApp = await startApp();
    const requestResponse = await requestingApp
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: "09123456789" },
      });

    expect(requestResponse.statusCode).toBe(202);
    const challenge = requestResponse.json<{
      challengeId: string;
      expiresAt: string;
    }>();
    expect(challenge.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    await requestingApp.close();
    apps.splice(apps.indexOf(requestingApp), 1);

    const verifyingApp = await startApp();
    const wrongCodeResponse = await verifyingApp
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: challenge.challengeId, code: "222222" },
      });
    expect(wrongCodeResponse.statusCode).toBe(401);
    expect(wrongCodeResponse.json()).toMatchObject({
      code: "UNAUTHORIZED",
      message: "کد واردشده درست نیست.",
    });

    const verifyResponse = await verifyingApp
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: challenge.challengeId, code: "111111" },
      });

    expect(verifyResponse.statusCode).toBe(200);
    expect(identitySessionContract.safeParse(verifyResponse.json()).success).toBe(true);
    expect(verifyResponse.json()).toMatchObject({
      actor: { audience: "PUBLIC" },
      maskedMobile: "0912***6789",
    });
    expect(JSON.stringify(verifyResponse.json())).not.toContain("09123456789");
    expect(JSON.stringify(verifyResponse.json())).not.toMatch(/role/i);
    expect(verifyResponse.headers["set-cookie"]).toContain("sevo_session=");
    expect(verifyResponse.headers["set-cookie"]).toContain("Max-Age=7776000");
    expect(verifyResponse.headers["set-cookie"]).toContain("HttpOnly");
    expect(verifyResponse.headers["set-cookie"]).toContain("SameSite=Lax");

    const sessionCookie = verifyResponse.headers["set-cookie"];
    await verifyingApp.close();
    apps.splice(apps.indexOf(verifyingApp), 1);

    const refreshedApp = await startApp();
    const sessionResponse = await refreshedApp
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: sessionCookie },
      });
    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toMatchObject({
      actor: verifyResponse.json().actor,
      maskedMobile: verifyResponse.json().maskedMobile,
    });

    const logoutResponse = await refreshedApp
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "DELETE",
        url: "/v1/auth/session",
        headers: { cookie: sessionCookie },
      });
    expect(logoutResponse.statusCode).toBe(204);
    expect(logoutResponse.headers["set-cookie"]).toContain("sevo_session=");
    expect(logoutResponse.headers["set-cookie"]).toContain("Max-Age=0");

    const loggedOutSessionResponse = await refreshedApp
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: sessionCookie },
      });
    expect(loggedOutSessionResponse.statusCode).toBe(401);

    const forgedSessionResponse = await refreshedApp
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: "sevo_session=forged" },
      });
    expect(forgedSessionResponse.statusCode).toBe(401);

    const legacySessionResponse = await refreshedApp
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: "sevo_seller_session=legacy" },
      });
    expect(legacySessionResponse.statusCode).toBe(401);
  });
});
