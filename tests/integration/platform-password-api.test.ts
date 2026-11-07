import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID, scryptSync } from "node:crypto";
import postgres from "postgres";
import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("platform password login API", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];
  beforeAll(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql.unsafe(
        readFileSync("ops/security/provision-superadmin-recovery.sql", "utf8"),
      );
    } finally {
      await sql.end();
    }
  });
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));
  it("rejects unknown credentials", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/v2/platform/auth/password/sessions",
        payload: { identifier: "unknown@example.test", password: "invalid password" },
      });
    expect(response.statusCode).toBe(401);
  });
  it("lets an authorized colleague sign in by username, mobile, or email", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const identity = randomUUID(),
      mobile = "09111119991";
    const salt = Buffer.alloc(16, 1).toString("base64url");
    const key = scryptSync("a valid secure password", salt, 64, {
      N: 16384,
      r: 8,
      p: 5,
      maxmem: 64 * 1024 * 1024,
    }).toString("base64url");
    try {
      await sql`insert into identity_identities (id, status) values (${identity}, 'ACTIVE')`;
      await sql`insert into identity_login_methods (id, identity_id, kind, mobile, verified_at) values (${randomUUID()}, ${identity}, 'MOBILE', ${mobile}, now())`;
      await sql`insert into identity_platform_permission_grants (id, identity_id, permission, granted_at) values (${randomUUID()}, ${identity}, 'DISPUTE_REVIEW', now())`;
      await sql`insert into identity_platform_passwords (identity_id, username, email, password_hash) values (${identity}, 'test.colleague', 'colleague@example.test', ${`scrypt$${salt}$${key}`})`;
      const app = await createApiApp(apiTestEnvironment);
      apps.push(app);
      for (const identifier of ["test.colleague", mobile, "COLLEAGUE@example.test"]) {
        const result = await app
          .getHttpAdapter()
          .getInstance()
          .inject({
            method: "POST",
            url: "/v2/platform/auth/password/sessions",
            payload: { identifier, password: "a valid secure password" },
          });
        expect(result.statusCode).toBe(200);
        expect(result.json().actor.identityId).toBe(identity);
        expect(result.headers["set-cookie"]).toContain("HttpOnly");
      }
    } finally {
      await sql`delete from identity_sessions where identity_id = ${identity}`;
      await sql`delete from identity_platform_permission_grants where identity_id = ${identity}`;
      await sql`delete from identity_identities where id = ${identity}`;
      await sql.end();
    }
  });
  it("denies colleague reset requests to a non-superadmin", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const identity = randomUUID(),
      token = "non-superadmin-test-session-token";
    try {
      await sql`insert into identity_identities (id, status) values (${identity}, 'ACTIVE')`;
      await sql`insert into identity_platform_permission_grants (id, identity_id, permission, granted_at) values (${randomUUID()}, ${identity}, 'ACCESS_ADMINISTRATION', now())`;
      await sql`insert into identity_sessions (id, identity_id, token_hash, audience, expires_at, platform_auth_method) values (${randomUUID()}, ${identity}, ${createHash("sha256").update(token).digest("hex")}, 'PLATFORM_AGENT', now() + interval '1 hour', 'PASSWORD')`;
      const app = await createApiApp(apiTestEnvironment);
      apps.push(app);
      const result = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          url: "/v2/platform/auth/password/recovery-requests",
          headers: { cookie: `sevo_platform_session=${token}` },
          payload: { identityId: randomUUID(), reason: "درخواست بازیابی دسترسی همکار" },
        });
      expect(result.statusCode).toBe(403);
    } finally {
      await sql`delete from identity_sessions where identity_id = ${identity}`;
      await sql`delete from identity_platform_permission_grants where identity_id = ${identity}`;
      await sql`delete from identity_identities where id = ${identity}`;
      await sql.end();
    }
  });
  it("lets a superadmin hand off one short-lived recovery code exactly once", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const admin = randomUUID(),
      colleague = randomUUID(),
      token = "recovery-superadmin-test-token";
    const salt = Buffer.alloc(16, 2).toString("base64url");
    const key = scryptSync("old valid password", salt, 64, {
      N: 16384,
      r: 8,
      p: 5,
      maxmem: 64 * 1024 * 1024,
    }).toString("base64url");
    try {
      await sql`insert into identity_identities (id, status) values (${admin}, 'ACTIVE'), (${colleague}, 'ACTIVE')`;
      await sql`insert into identity_platform_superadmins (identity_id, granted_at) values (${admin}, now())`;
      await sql`insert into identity_platform_permission_grants (id, identity_id, permission, granted_at) values (${randomUUID()}, ${colleague}, 'SELLER_APPLICATION_REVIEW', now())`;
      await sql`insert into identity_platform_passwords (identity_id, username, password_hash) values (${colleague}, 'reset.colleague', ${`scrypt$${salt}$${key}`})`;
      await sql`insert into identity_sessions (id, identity_id, token_hash, audience, expires_at, platform_auth_method) values (${randomUUID()}, ${admin}, ${createHash("sha256").update(token).digest("hex")}, 'PLATFORM_AGENT', now() + interval '1 hour', 'PASSWORD')`;
      const oldToken = randomUUID();
      await sql`insert into identity_sessions (id, identity_id, token_hash, audience, expires_at) values (${randomUUID()}, ${colleague}, ${createHash("sha256").update(oldToken).digest("hex")}, 'PLATFORM_AGENT', now() + interval '1 hour')`;
      const app = await createApiApp(apiTestEnvironment);
      apps.push(app);
      const server = app.getHttpAdapter().getInstance();
      const request = await server.inject({
        method: "POST",
        url: "/v2/platform/auth/password/recovery-requests",
        headers: { cookie: `sevo_platform_session=${token}` },
        payload: { identityId: colleague, reason: "درخواست بازیابی دسترسی همکار" },
      });
      expect(request.statusCode).toBe(201);
      expect(request.headers["cache-control"]).toBe("no-store");
      const code = request.json().code;
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const [stored] =
        await sql`select token_hash from identity_platform_password_recoveries where identity_id = ${colleague}`;
      expect(stored?.token_hash).not.toBe(code);
      const payload = { code, password: "new valid secure password" };
      const redemptions = await Promise.all(
        Array.from({ length: 2 }, () =>
          server.inject({
            method: "POST",
            url: "/v2/platform/auth/password/recovery",
            payload,
          }),
        ),
      );
      expect(redemptions.map((result) => result.statusCode).sort()).toEqual(
        [204, 401].sort(),
      );
      const oldSession = await server.inject({
        method: "GET",
        url: "/v1/platform/auth/session",
        headers: { cookie: `sevo_platform_session=${oldToken}` },
      });
      expect(oldSession.statusCode).toBe(401);
      const replay = await server.inject({
        method: "POST",
        url: "/v2/platform/auth/password/recovery",
        payload,
      });
      expect(replay.statusCode).toBe(401);
      const login = await server.inject({
        method: "POST",
        url: "/v2/platform/auth/password/sessions",
        payload: { identifier: "reset.colleague", password: payload.password },
      });
      expect(login.statusCode).toBe(200);
    } finally {
      await sql`truncate identity_platform_password_recovery_audit`;
      await sql`delete from identity_platform_password_recoveries where identity_id = ${colleague}`;
      await sql`delete from identity_sessions where identity_id in (${admin}, ${colleague})`;
      await sql`delete from identity_platform_permission_grants where identity_id = ${colleague}`;
      await sql`truncate identity_platform_superadmins`;
      await sql`delete from identity_identities where id in (${admin}, ${colleague})`;
      await sql.end();
    }
  });

  it("allows a password-authenticated security agent to revoke public sessions without a second factor", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const agent = randomUUID(),
      target = randomUUID(),
      token = randomUUID();
    try {
      await sql`insert into identity_identities (id, status) values (${agent}, 'ACTIVE'), (${target}, 'ACTIVE')`;
      await sql`insert into identity_platform_permission_grants (id, identity_id, permission, granted_at) values (${randomUUID()}, ${agent}, 'SESSION_SECURITY', now())`;
      await sql`insert into identity_sessions (id, identity_id, token_hash, audience, expires_at, platform_auth_method) values (${randomUUID()}, ${agent}, ${createHash("sha256").update(token).digest("hex")}, 'PLATFORM_AGENT', now() + interval '1 hour', 'PASSWORD')`;
      await sql`insert into identity_sessions (id, identity_id, token_hash, audience, expires_at) values (${randomUUID()}, ${target}, ${createHash("sha256").update(randomUUID()).digest("hex")}, 'PUBLIC', now() + interval '1 hour')`;
      const app = await createApiApp(apiTestEnvironment);
      apps.push(app);
      const otpToken = randomUUID();
      await sql`insert into identity_sessions (id, identity_id, token_hash, audience, expires_at) values (${randomUUID()}, ${agent}, ${createHash("sha256").update(otpToken).digest("hex")}, 'PLATFORM_AGENT', now() + interval '1 hour')`;
      const denied = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          url: "/v2/platform/security/session-revocations",
          headers: { cookie: `sevo_platform_session=${otpToken}` },
          payload: {
            targetIdentityId: target,
            incidentId: "INC-TEST",
            reason: "suspicious session reported",
          },
        });
      expect(denied.statusCode).toBe(403);
      const result = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          url: "/v2/platform/security/session-revocations",
          headers: { cookie: `sevo_platform_session=${token}` },
          payload: {
            targetIdentityId: target,
            incidentId: "INC-TEST",
            reason: "suspicious session reported",
          },
        });
      expect(result.statusCode).toBe(204);
      const [session] =
        await sql`select revoked_at from identity_sessions where identity_id = ${target}`;
      expect(session?.revoked_at).not.toBeNull();
    } finally {
      await sql`truncate identity_session_security_audit`;
      await sql`delete from identity_sessions where identity_id in (${agent}, ${target})`;
      await sql`delete from identity_platform_permission_grants where identity_id = ${agent}`;
      await sql`delete from identity_identities where id in (${agent}, ${target})`;
      await sql.end();
    }
  });

  it("allows owner recovery when a previously enrolled TOTP factor is lost", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const identity = randomUUID();
    const recoveryKey = randomUUID();
    const salt = Buffer.alloc(16, 3).toString("base64url");
    const key = scryptSync("owner new secure password", salt, 64, {
      N: 16384,
      r: 8,
      p: 5,
      maxmem: 64 * 1024 * 1024,
    }).toString("base64url");
    try {
      await sql`insert into identity_identities (id, status) values (${identity}, 'ACTIVE')`;
      await sql`insert into identity_platform_superadmins (identity_id, granted_at) values (${identity}, now())`;
      await sql`insert into identity_totp_factors (identity_id, enrollment_session_id, key_id, ciphertext, nonce, tag, status, expires_at) values (${identity}, ${randomUUID()}, 'test', ${Buffer.alloc(16)}, ${Buffer.alloc(12)}, ${Buffer.alloc(16)}, 'ACTIVE', now() + interval '1 day')`;
      await sql`select public.identity_owner_recover_platform_password(${identity}::uuid, 'owner.recovered', null, ${`scrypt$${salt}$${key}`}, 'recover inaccessible administrator', ${recoveryKey}::uuid)`;
      const app = await createApiApp(apiTestEnvironment);
      apps.push(app);
      const result = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          url: "/v2/platform/auth/password/sessions",
          payload: {
            identifier: "owner.recovered",
            password: "owner new secure password",
          },
        });
      expect(result.statusCode).toBe(200);
      expect(result.json().actor.identityId).toBe(identity);
    } finally {
      await sql`truncate identity_platform_superadmin_audit`;
      await sql`delete from identity_platform_superadmin_recovery_idempotency where key = ${recoveryKey}`;
      await sql`delete from identity_sessions where identity_id = ${identity}`;
      await sql`truncate identity_platform_superadmins`;
      await sql`delete from identity_identities where id = ${identity}`;
      await sql.end();
    }
  });
  it("allows a superadmin to issue first credentials to an authorized colleague", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const admin = randomUUID(),
      colleague = randomUUID(),
      token = randomUUID();
    const username = `new${colleague.replaceAll("-", "")}`;
    try {
      await sql`insert into identity_identities (id, status) values (${admin}, 'ACTIVE'), (${colleague}, 'ACTIVE')`;
      await sql`insert into identity_platform_superadmins (identity_id, granted_at) values (${admin}, now())`;
      await sql`insert into identity_platform_permission_grants (id, identity_id, permission, granted_at) values (${randomUUID()}, ${colleague}, 'SELLER_APPLICATION_REVIEW', now())`;
      await sql`insert into identity_sessions (id, identity_id, token_hash, audience, expires_at, platform_auth_method) values (${randomUUID()}, ${admin}, ${createHash("sha256").update(token).digest("hex")}, 'PLATFORM_AGENT', now() + interval '1 hour', 'PASSWORD')`;
      const app = await createApiApp(apiTestEnvironment);
      apps.push(app);
      const server = app.getHttpAdapter().getInstance();
      const issue = await server.inject({
        method: "POST",
        url: "/v2/platform/auth/password/recovery-requests",
        headers: { cookie: `sevo_platform_session=${token}` },
        payload: {
          identityId: colleague,
          username,
          reason: "راه‌اندازی دسترسی همکار مجاز",
        },
      });
      expect(issue.statusCode).toBe(201);
      const reset = await server.inject({
        method: "POST",
        url: "/v2/platform/auth/password/recovery",
        payload: { code: issue.json().code, password: "first secure password" },
      });
      expect(reset.statusCode).toBe(204);
      const login = await server.inject({
        method: "POST",
        url: "/v2/platform/auth/password/sessions",
        payload: { identifier: username, password: "first secure password" },
      });
      expect(login.statusCode).toBe(200);
    } finally {
      await sql`truncate identity_platform_password_recovery_audit`;
      await sql`delete from identity_platform_password_recoveries where identity_id = ${colleague}`;
      await sql`delete from identity_sessions where identity_id in (${admin}, ${colleague})`;
      await sql`delete from identity_platform_permission_grants where identity_id = ${colleague}`;
      await sql`truncate identity_platform_superadmins`;
      await sql`delete from identity_identities where id in (${admin}, ${colleague})`;
      await sql.end();
    }
  });

  it("only lets the owner recovery login run the password recovery tool", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const identity = randomUUID(),
      role = `owner_276_${randomUUID().replaceAll("-", "")}`;
    const connection = new URL(apiTestEnvironment.DATABASE_URL);
    connection.username = role;
    connection.password = "temporary-test-password";
    const input = JSON.stringify({
      identityId: identity,
      username: `owner${identity.replaceAll("-", "")}`,
      reason: "بازیابی دسترسی مدیر از مسیر مالک",
      idempotencyKey: randomUUID(),
      password: "owner secure test password",
    });
    const run = () =>
      spawnSync(process.execPath, ["scripts/recover-superadmin-password.mjs"], {
        input,
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: connection.toString() },
      });
    try {
      await sql`insert into identity_identities (id, status) values (${identity}, 'ACTIVE')`;
      await sql.unsafe(
        `create role "${role}" login password 'temporary-test-password'`,
      );
      expect(run().status).not.toBe(0);
      await sql.unsafe(`grant sevo_superadmin_recovery to "${role}"`);
      const restricted = postgres(connection.toString(), { max: 1 });
      try {
        await expect(
          restricted`select * from identity_platform_passwords`,
        ).rejects.toThrow();
      } finally {
        await restricted.end();
      }
      const grantInput = JSON.stringify({
        identityId: identity,
        reason: "بازیابی مدیریت پس از قطع دسترسی",
        idempotencyKey: randomUUID(),
      });
      const grant = spawnSync(process.execPath, ["scripts/recover-superadmin.mjs"], {
        input: grantInput,
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: connection.toString() },
      });
      expect(grant.status).toBe(0);
      const result = run();
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("owner secure test password");
      expect(run().status).not.toBe(0);
      const app = await createApiApp(apiTestEnvironment);
      apps.push(app);
      const login = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          url: "/v2/platform/auth/password/sessions",
          payload: {
            identifier: `owner${identity.replaceAll("-", "")}`,
            password: "owner secure test password",
          },
        });
      expect(login.statusCode).toBe(200);
    } finally {
      await sql.unsafe(`drop role if exists "${role}"`);
      await sql`truncate identity_platform_superadmin_audit`;
      await sql`delete from identity_platform_superadmin_recovery_idempotency`;
      await sql`delete from identity_sessions where identity_id = ${identity}`;
      await sql`truncate identity_platform_superadmins`;
      await sql`delete from identity_identities where id = ${identity}`;
      await sql.end();
    }
  });

  it("bounds total password guesses across many different identifiers", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql`update identity_platform_password_admission set attempts = 60, window_started_at = clock_timestamp() where id = 1`;
      const app = await createApiApp(apiTestEnvironment);
      apps.push(app);
      const result = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          url: "/v2/platform/auth/password/sessions",
          payload: {
            identifier: "new-attacker@example.test",
            password: "a valid password",
          },
        });
      expect(result.statusCode).toBe(429);
    } finally {
      await sql`update identity_platform_password_admission set attempts = 0, window_started_at = clock_timestamp() where id = 1`;
      await sql.end();
    }
  });
});
