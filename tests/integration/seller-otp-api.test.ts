import { sellerSessionContract } from "@sevo/contracts/identity-access/v1";
import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("seller OTP HTTP API with PostgreSQL", () => {
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

  it("rejects a mobile that is not an allowed Iranian test number", async () => {
    const app = await startApp();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: "09120000000" },
      });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "این شماره برای ورود آزمایشی در دسترس نیست.",
      details: { issues: [{ field: "mobile", code: "INVALID_FORMAT" }] },
    });
  });

  it("persists a challenge across an app restart and creates a seller session", async () => {
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
    expect(sellerSessionContract.safeParse(verifyResponse.json()).success).toBe(true);
    expect(verifyResponse.headers["set-cookie"]).toContain("sevo_seller_session=");
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

    const forgedSessionResponse = await refreshedApp
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: "sevo_seller_session=forged" },
      });
    expect(forgedSessionResponse.statusCode).toBe(401);
  });
});
