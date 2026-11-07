import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import { createApiApp } from "../../apps/api/src/create-app";
import { createActiveSellerFixture } from "../../apps/api/src/modules/identity-access/testing/active-seller.fixture";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("seller password HTTP API", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("enrolls an optional password for the signed-in seller and logs in to the same identity", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const challenge = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "09123456789" },
    });
    const otp = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId: challenge.json().challengeId, code: "111111" },
    });
    const fixture = await createActiveSellerFixture(
      apiTestEnvironment.DATABASE_URL,
      otp.json().actor.identityId,
    );
    try {
      const enrollment = await server.inject({
        method: "POST",
        url: "/v1/auth/password",
        headers: { cookie: otp.headers["set-cookie"] },
        payload: { password: "correct horse battery staple" },
      });
      expect(enrollment.statusCode).toBe(204);
      const login = await server.inject({
        method: "POST",
        url: "/v1/auth/password/sessions",
        payload: { mobile: "09123456789", password: "correct horse battery staple" },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().actor).toEqual(otp.json().actor);
      expect(login.headers["set-cookie"]).toContain("HttpOnly");
    } finally {
      const sql = postgres(apiTestEnvironment.DATABASE_URL);
      await sql`delete from identity_seller_passwords where identity_id = ${otp.json().actor.identityId}`;
      await sql`delete from identity_password_attempts where mobile = '09123456789'`;
      await sql.end();
      await fixture.cleanup();
    }
  });
});
