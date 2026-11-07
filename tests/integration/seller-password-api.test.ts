import { afterEach, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createApiApp } from "../../apps/api/src/create-app";
import { createActiveSellerFixture } from "../../apps/api/src/modules/identity-access/testing/active-seller.fixture";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("seller password HTTP API", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];
  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL);
    await sql`delete from identity_otp_challenges where mobile = '09123456789'`;
    await sql`delete from identity_password_attempts where mobile in ('09123456789', '09100000000')`;
    await sql`update identity_password_admission set attempts = 0, window_started_at = clock_timestamp() where id = 1`;
    await sql.end();
  });
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("reports malformed mobile and recovery code against the right fields", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const login = await server.inject({
      method: "POST",
      url: "/v1/auth/password/sessions",
      payload: { mobile: "bad", password: "a valid password" },
    });
    expect(login.statusCode).toBe(422);
    expect(login.json().details.issues).toEqual([
      { field: "mobile", code: "INVALID_FORMAT" },
    ]);
    const reset = await server.inject({
      method: "POST",
      url: "/v1/auth/password/recovery",
      payload: {
        challengeId: "f0b7d9db-90af-44a6-b2ba-a8ccbe92e0e9",
        code: "123",
        password: "a valid password",
      },
    });
    expect(reset.statusCode).toBe(422);
    expect(reset.json().details.issues).toEqual([
      { field: "code", code: "INVALID_FORMAT" },
    ]);
  });

  it("does not let a held number occupy password slots or block another number", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 2 });
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    try {
      const holder = sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext('09100000001'))`;
        acquired();
        await gate;
      });
      await held;
      const blocked = await Promise.all(
        Array.from({ length: 6 }, () =>
          server.inject({
            method: "POST",
            url: "/v1/auth/password/sessions",
            payload: { mobile: "09100000001", password: "wrong secure password" },
          }),
        ),
      );
      expect(blocked.every((result) => result.statusCode === 429)).toBe(true);
      const other = await server.inject({
        method: "POST",
        url: "/v1/auth/password/sessions",
        payload: { mobile: "09100000002", password: "wrong secure password" },
      });
      expect(other.statusCode).toBe(401);
      release();
      await holder;
    } finally {
      release();
      await sql`delete from identity_password_attempts where mobile in ('09100000001', '09100000002')`;
      await sql.end();
    }
  });

  it("bounds concurrent password work across different numbers before recording attempts", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 2 });
    const mobiles = ["09100000001", "09100000002", "09100000003"];
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    try {
      await sql`delete from identity_password_attempts where mobile in ${sql(mobiles)}`;
      const holder = sql.begin(async (tx) => {
        for (let slot = 0; slot < 4; slot++) {
          await tx`select pg_advisory_xact_lock(hashtextextended('sevo-password-admission-v1', 274) + ${slot})`;
        }
        acquired();
        await gate;
      });
      await held;
      const results = await Promise.all(
        mobiles.map((mobile) =>
          server.inject({
            method: "POST",
            url: "/v1/auth/password/sessions",
            payload: { mobile, password: "wrong secure password" },
          }),
        ),
      );
      expect(results.map((response) => response.statusCode)).toEqual([429, 429, 429]);
      expect(new Set(results.map((response) => response.json().message)).size).toBe(1);
      const [count] = await sql<
        Array<{ count: number }>
      >`select count(*)::int as count from identity_password_attempts where mobile in ${sql(mobiles)}`;
      expect(count?.count).toBe(0);
      release();
      await holder;
    } finally {
      release();
      await sql`delete from identity_password_attempts where mobile in ${sql(mobiles)}`;
      await sql.end();
    }
  });

  it("allows cross-number admissions and incrementally removes expired attempt records", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const sql = postgres(apiTestEnvironment.DATABASE_URL);
    const mobiles = ["09100000004", "09100000005", "09100000006"];
    try {
      await sql`delete from identity_password_attempts where mobile like '090%' or mobile in ${sql(mobiles)}`;
      await sql`insert into identity_password_attempts (mobile, attempts, window_started_at) select '090' || lpad(n::text, 8, '0'), 1, '2000-01-01'::timestamptz from generate_series(1, 102) n`;
      await sql`update identity_password_admission set attempts = 59, window_started_at = clock_timestamp() where id = 1`;
      for (const mobile of mobiles) {
        expect(
          (
            await server.inject({
              method: "POST",
              url: "/v1/auth/password/sessions",
              payload: { mobile, password: "wrong secure password" },
            })
          ).statusCode,
        ).toBe(401);
      }
      const [created] = await sql<
        Array<{ count: number }>
      >`select count(*)::int as count from identity_password_attempts where mobile in ${sql(mobiles)}`;
      const [expired] = await sql<
        Array<{ count: number }>
      >`select count(*)::int as count from identity_password_attempts where mobile like '090%' and window_started_at < clock_timestamp() - interval '15 minutes'`;
      expect(created?.count).toBe(3);
      expect(expired?.count).toBe(0);
    } finally {
      await sql`delete from identity_password_attempts where mobile like '090%' or mobile in ${sql(mobiles)}`;
      await sql`update identity_password_admission set attempts = 0, window_started_at = clock_timestamp() where id = 1`;
      await sql.end();
    }
  });

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
    const sql = postgres(apiTestEnvironment.DATABASE_URL);
    const platformToken = randomBytes(32).toString("base64url");
    const platformHash = createHash("sha256").update(platformToken).digest("hex");
    try {
      for (let attempt = 0; attempt < 60; attempt++) {
        const bogus = await server.inject({
          method: "POST",
          url: "/v1/auth/password/recovery",
          payload: {
            challengeId: randomUUID(),
            code: "111111",
            password: "invalid reset password",
          },
        });
        expect(bogus.statusCode).toBe(401);
      }
      await sql`insert into identity_sessions (id, token_hash, identity_id, audience, expires_at) values (${randomUUID()}, ${platformHash}, ${otp.json().actor.identityId}, 'PLATFORM_AGENT', now() + interval '1 hour')`;
      const enrollment = await server.inject({
        method: "POST",
        url: "/v1/auth/password",
        headers: { cookie: otp.headers["set-cookie"] },
        payload: { password: "correct horse battery staple" },
      });
      expect(enrollment.statusCode).toBe(204);
      await sql`insert into identity_password_attempts (mobile, attempts, window_started_at) select '093' || lpad(n::text, 8, '0'), 1, clock_timestamp() from generate_series(1, 10000) n on conflict (mobile) do update set window_started_at = excluded.window_started_at`;
      const anonymousAtCapacity = await server.inject({
        method: "POST",
        url: "/v1/auth/password/sessions",
        payload: { mobile: "09100000009", password: "wrong secure password" },
      });
      const sellerAtCapacity = await server.inject({
        method: "POST",
        url: "/v1/auth/password/sessions",
        payload: { mobile: "09123456789", password: "correct horse battery staple" },
      });
      expect(anonymousAtCapacity.statusCode).toBe(401);
      expect(sellerAtCapacity.statusCode).toBe(200);
      await sql`delete from identity_password_attempts where mobile like '093%'`;
      const bad = await server.inject({
        method: "POST",
        url: "/v1/auth/password/sessions",
        payload: { mobile: "09123456789", password: "wrong secure password" },
      });
      const unknown = await server.inject({
        method: "POST",
        url: "/v1/auth/password/sessions",
        payload: { mobile: "09100000000", password: "wrong secure password" },
      });
      expect(bad.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(bad.json().message).toBe(unknown.json().message);
      for (let attempt = 0; attempt < 9; attempt++) {
        expect(
          (
            await server.inject({
              method: "POST",
              url: "/v1/auth/password/sessions",
              payload: { mobile: "09123456789", password: "wrong secure password" },
            })
          ).statusCode,
        ).toBe(401);
      }
      const locked = await server.inject({
        method: "POST",
        url: "/v1/auth/password/sessions",
        payload: { mobile: "09123456789", password: "correct horse battery staple" },
      });
      expect(locked.statusCode).toBe(401);
      expect(locked.json().message).toBe(unknown.json().message);
      await sql`update identity_password_attempts set window_started_at = clock_timestamp() - interval '16 minutes' where mobile = '09123456789'`;
      for (let n = 0; n < 60; n++) {
        const mobile = `092${String(n).padStart(8, "0")}`;
        expect(
          (
            await server.inject({
              method: "POST",
              url: "/v1/auth/password/sessions",
              payload: { mobile, password: "wrong secure password" },
            })
          ).statusCode,
        ).toBe(401);
      }
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
      expect(
        (
          await server.inject({
            method: "GET",
            url: "/v1/platform/auth/session",
            headers: { cookie: `sevo_platform_session=${platformToken}` },
          })
        ).statusCode,
      ).toBe(200);
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
      await sql`delete from identity_sessions where token_hash = ${platformHash}`;
      await sql`delete from identity_seller_passwords where identity_id = ${otp.json().actor.identityId}`;
      await sql`delete from identity_password_attempts where mobile = '09123456789'`;
      await sql`delete from identity_password_attempts where mobile = '09100000000'`;
      await sql`delete from identity_password_attempts where mobile like '09200000%'`;
      await sql`delete from identity_password_attempts where mobile like '093%'`;
      await sql.end();
      await fixture.cleanup();
    }
  }, 90000);

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
      const passwordLogin = server.inject({
        method: "POST",
        url: "/v1/auth/password/sessions",
        payload: { mobile: "09123456789", password: "old secure password" },
      });
      expect((await passwordLogin).statusCode).toBe(429);
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

  it("rejects a recovery code that expires while waiting for the identity lock", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 4 });
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
      const recovery = await server.inject({
        method: "POST",
        url: "/v1/auth/password/recovery/requests",
        payload: { mobile: "09123456789" },
      });
      const challengeId = recovery.json().challengeId;
      await sql`update identity_otp_challenges set expires_at = clock_timestamp() + interval '3 seconds' where id = ${challengeId}`;
      const holder = sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${identityId}, 273))`;
        acquired();
        await gate;
      });
      await held;
      const reset = server.inject({
        method: "POST",
        url: "/v1/auth/password/recovery",
        payload: { challengeId, code: "111111", password: "new secure password" },
      });
      for (let i = 0; i < 100; i++) {
        const [row] = await sql<
          Array<{ blocked: boolean }>
        >`select exists(select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()) as blocked`;
        if (row?.blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (i === 99) throw new Error("Reset did not wait for identity lock");
      }
      await sql`select pg_sleep(3.2)`;
      release();
      await holder;
      expect((await reset).statusCode).toBe(401);
      expect(
        (
          await server.inject({
            method: "GET",
            url: "/v1/auth/session",
            headers: { cookie: otp.headers["set-cookie"] },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      release();
      await sql`delete from identity_seller_passwords where identity_id = ${identityId}`;
      await sql`delete from identity_password_attempts where mobile = '09123456789'`;
      await sql.end();
      await fixture.cleanup();
    }
  });
});
