import {
  identitySessionContract,
  iranianMobileContract,
} from "@sevo/contracts/identity-access/v1";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("identity session HTTP API with PostgreSQL", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function startApp(environment = apiTestEnvironment) {
    const app = await createApiApp(environment);
    apps.push(app);
    return app;
  }

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
    });
    expect(JSON.stringify(verifyResponse.json())).not.toMatch(/mobile|role/i);
    expect(verifyResponse.headers["set-cookie"]).toContain("sevo_session=");
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
    expect(sessionResponse.json()).toEqual(verifyResponse.json());

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
