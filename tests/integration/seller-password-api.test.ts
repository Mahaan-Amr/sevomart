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
      const pendingLogin = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: "09123456789" },
      });
      const recovery = await server.inject({
        method: "POST",
        url: "/v1/auth/password/recovery/requests",
        payload: { mobile: "09123456789" },
      });
      expect(recovery.statusCode).toBe(202);
      const wrongPurpose = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: recovery.json().challengeId, code: "111111" },
      });
      expect(wrongPurpose.statusCode).toBe(401);
      const reset = await server.inject({
        method: "POST",
        url: "/v1/auth/password/recovery",
        payload: {
          challengeId: recovery.json().challengeId,
          code: "111111",
          password: "a new secure password",
        },
      });
      expect(reset.statusCode).toBe(204);
      const replay = await server.inject({
        method: "POST",
        url: "/v1/auth/password/recovery",
        payload: {
          challengeId: recovery.json().challengeId,
          code: "111111",
          password: "another secure password",
        },
      });
      expect(replay.statusCode).toBe(401);
      const oldOtp = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: pendingLogin.json().challengeId, code: "111111" },
      });
      expect(oldOtp.statusCode).toBe(401);
      const oldSession = await server.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: login.headers["set-cookie"] },
      });
      expect(oldSession.statusCode).toBe(401);
      const newLogin = await server.inject({
        method: "POST",
        url: "/v1/auth/password/sessions",
        payload: { mobile: "09123456789", password: "a new secure password" },
      });
      expect(newLogin.statusCode).toBe(200);
    } finally {
      const sql = postgres(apiTestEnvironment.DATABASE_URL);
      await sql`delete from identity_seller_passwords where identity_id = ${otp.json().actor.identityId}`;
      await sql`delete from identity_password_attempts where mobile = '09123456789'`;
      await sql.end();
      await fixture.cleanup();
    }
  });

  it("does not issue an old OTP session after a concurrent reset wins the identity lock", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 4 });
    await sql`delete from identity_otp_challenges where mobile = '09123456789'`;
    const initial = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "09123456789" },
    });
    const otp = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId: initial.json().challengeId, code: "111111" },
    });
    const identityId = otp.json().actor.identityId;
    const fixture = await createActiveSellerFixture(
      apiTestEnvironment.DATABASE_URL,
      identityId,
    );
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    try {
      await sql`delete from identity_seller_passwords where identity_id = ${identityId}`;
      await sql`delete from identity_password_attempts where mobile = '09123456789'`;
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/v1/auth/password",
            headers: { cookie: otp.headers["set-cookie"] },
            payload: { password: "old secure password" },
          })
        ).statusCode,
      ).toBe(204);
      const old = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: "09123456789" },
      });
      const recovery = await server.inject({
        method: "POST",
        url: "/v1/auth/password/recovery/requests",
        payload: { mobile: "09123456789" },
      });
      const holder = sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${identityId}, 273))`;
        acquired();
        await gate;
      });
      await held;
      const reset = server.inject({
        method: "POST",
        url: "/v1/auth/password/recovery",
        payload: {
          challengeId: recovery.json().challengeId,
          code: "111111",
          password: "new secure password",
        },
      });
      const waitForLocks = async (count: number) => {
        for (let i = 0; i < 150; i++) {
          const [row] = await sql<
            Array<{ count: number }>
          >`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`;
          if ((row?.count ?? 0) >= count) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`Expected ${count} blocked requests`);
      };
      await waitForLocks(1);
      const oldLogin = server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: old.json().challengeId, code: "111111" },
      });
      await waitForLocks(2);
      release();
      await holder;
      expect((await reset).statusCode).toBe(204);
      expect((await oldLogin).statusCode).toBe(401);
    } finally {
      release();
      await sql`delete from identity_seller_passwords where identity_id = ${identityId}`;
      await sql`delete from identity_password_attempts where mobile = '09123456789'`;
      await sql.end();
      await fixture.cleanup();
    }
  });
});
