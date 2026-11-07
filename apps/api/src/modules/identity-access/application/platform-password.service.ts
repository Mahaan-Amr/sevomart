import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import postgres from "postgres";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const dummy = `scrypt$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(64).toString("base64url")}`;
async function encodePassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const key = await new Promise<Buffer>((resolve, reject) =>
    scryptCallback(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 },
      (error, value) => (error ? reject(error) : resolve(value)),
    ),
  );
  return `scrypt$${salt}$${key.toString("base64url")}`;
}
async function verify(password: string, encoded: string) {
  const [, salt, key] = encoded.split("$");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await new Promise<Buffer>((resolve, reject) =>
    scryptCallback(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 },
      (error, value) => (error ? reject(error) : resolve(value)),
    ),
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export class PlatformPasswordBusyError extends Error {}
export class PlatformPasswordSessionExpiredError extends Error {}
export class PlatformPasswordService {
  readonly #sql: postgres.Sql;
  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }
  async login(rawIdentifier: string, password: string) {
    const identifier = rawIdentifier.trim().toLowerCase();
    return this.#sql.begin(async (sql) => {
      const credentials = await sql<
        { identityId: string; passwordHash: string | null }[]
      >`select p.identity_id as "identityId", p.password_hash as "passwordHash" from identity_platform_passwords p left join identity_login_methods m on m.identity_id = p.identity_id and m.kind = 'MOBILE' where p.username = ${identifier} or p.email = ${identifier} or m.mobile = ${identifier} limit 2`;
      const credential = credentials.length === 1 ? credentials[0] : undefined;
      const bucket = digest(
        credential ? `identity:${credential.identityId}` : `unknown:${identifier}`,
      );
      const [lock] = await sql<
        { acquired: boolean }[]
      >`select pg_try_advisory_xact_lock(hashtextextended(${bucket}, 276)) as acquired`;
      if (!lock?.acquired) throw new PlatformPasswordBusyError();
      let admitted = false;
      for (const slot of credential ? [3, 0, 1, 2] : [0, 1, 2]) {
        const [capacity] = await sql<
          { acquired: boolean }[]
        >`select pg_try_advisory_xact_lock(hashtextextended('platform-password-work', 276) + ${slot}) as acquired`;
        if (capacity?.acquired) {
          admitted = true;
          break;
        }
      }
      if (!admitted) throw new PlatformPasswordBusyError();
      await sql`delete from identity_platform_password_attempts where identifier_hash in (select identifier_hash from identity_platform_password_attempts where window_started_at < now() - interval '15 minutes' limit 100 for update skip locked)`;
      const [count] = await sql<
        { total: number }[]
      >`select count(*)::int as total from identity_platform_password_attempts`;
      const [existing] = await sql<
        { attempts: number }[]
      >`select attempts from identity_platform_password_attempts where identifier_hash = ${bucket}`;
      if (!credential && !existing && (count?.total ?? 0) >= 10000) {
        await verify(password, dummy);
        return;
      }
      const [attempt] = await sql<
        { attempts: number }[]
      >`insert into identity_platform_password_attempts (identifier_hash, attempts, window_started_at) values (${bucket}, 1, now()) on conflict (identifier_hash) do update set attempts = case when identity_platform_password_attempts.window_started_at < now() - interval '15 minutes' then 1 else least(identity_platform_password_attempts.attempts + 1, 11) end, window_started_at = case when identity_platform_password_attempts.window_started_at < now() - interval '15 minutes' then now() else identity_platform_password_attempts.window_started_at end returning attempts`;
      const valid = await verify(
        password,
        attempt && attempt.attempts <= 10 ? (credential?.passwordHash ?? dummy) : dummy,
      );
      if (
        !credential ||
        !credential.passwordHash ||
        !valid ||
        !attempt ||
        attempt.attempts > 10
      )
        return;
      await sql`select pg_advisory_xact_lock(hashtextextended(${credential.identityId}, 301))`;
      const [identity] = await sql<
        { isSuperadmin: boolean; permission: string | null }[]
      >`select exists(select 1 from identity_platform_superadmins a where a.identity_id = i.id and a.revoked_at is null) as "isSuperadmin", (select permission from identity_platform_permission_grants g where g.identity_id = i.id and g.revoked_at is null order by permission limit 1) as permission from identity_identities i join identity_platform_passwords p on p.identity_id = i.id where i.id = ${credential.identityId} and i.status = 'ACTIVE' and p.password_hash = ${credential.passwordHash} and (p.username = ${identifier} or p.email = ${identifier} or exists (select 1 from identity_login_methods m where m.identity_id = i.id and m.kind = 'MOBILE' and m.mobile = ${identifier})) for share of i, p`;
      if (!identity || (!identity.isSuperadmin && !identity.permission)) return;
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
      await sql`insert into identity_sessions (id, token_hash, identity_id, audience, expires_at, platform_auth_method) values (${randomUUID()}, ${digest(token)}, ${credential.identityId}, 'PLATFORM_AGENT', ${expiresAt}, 'PASSWORD')`;
      await sql`delete from identity_platform_password_attempts where identifier_hash = ${bucket}`;
      return {
        token,
        session: {
          actor: {
            identityId: credential.identityId,
            audience: "PLATFORM_AGENT" as const,
          },
          ...(identity.permission
            ? { permission: identity.permission }
            : { role: "SUPERADMIN" as const }),
          expiresAt: expiresAt.toISOString(),
        },
      };
    });
  }
  async requestRecovery(
    sessionToken: string,
    targetId: string,
    reason: string,
    correlationId: string,
    username?: string,
    email?: string,
  ) {
    return this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext('identity_platform_superadmins'))`;
      const [actor] = await sql<
        { identityId: string }[]
      >`select s.identity_id as "identityId" from identity_sessions s join identity_identities i on i.id = s.identity_id and i.status = 'ACTIVE' join identity_platform_superadmins a on a.identity_id = i.id and a.revoked_at is null where s.token_hash = ${digest(sessionToken)} and s.audience = 'PLATFORM_AGENT' and s.platform_auth_method = 'PASSWORD' and s.revoked_at is null and s.expires_at > clock_timestamp() for share of s, i, a`;
      if (!actor) return;
      await sql`select pg_advisory_xact_lock(hashtextextended(${targetId}, 301))`;
      const [target] = await sql<
        { id: string }[]
      >`select i.id from identity_identities i where i.id = ${targetId} and i.status = 'ACTIVE' and i.id <> ${actor.identityId} and exists (select 1 from identity_platform_permission_grants g where g.identity_id = i.id and g.revoked_at is null) and not exists (select 1 from identity_platform_superadmins a where a.identity_id = i.id and a.revoked_at is null) for share of i`;
      if (!target) return;
      const grants = await sql<
        { id: string }[]
      >`select id from identity_platform_permission_grants where identity_id = ${targetId} and revoked_at is null order by id for share`;
      if (!grants[0]) return;
      const [role] = await sql<
        { generationId: string }[]
      >`select generation_id as "generationId" from identity_platform_superadmins where identity_id = ${targetId} for share`;
      const [existing] = await sql<
        { username: string }[]
      >`select username from identity_platform_passwords where identity_id = ${targetId} for update`;
      if (!existing && !username) return;
      if (existing && username && username !== existing.username) return;
      const collision =
        await sql`select identity_id from identity_platform_passwords where identity_id <> ${targetId} and (username = ${username ?? null} or email = ${username ?? null} or username = ${email ?? null} or email = ${email ?? null})`;
      if (collision.length) return;
      if (!existing) {
        await sql`insert into identity_platform_passwords (identity_id, username, email, password_hash) values (${targetId}, ${username!}, ${email ?? null}, null)`;
      } else if (email) {
        await sql`update identity_platform_passwords set email = ${email} where identity_id = ${targetId}`;
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await sql`update identity_platform_password_recoveries set consumed_at = clock_timestamp() where identity_id = ${targetId} and consumed_at is null`;
      await sql`insert into identity_platform_password_recoveries (id, identity_id, token_hash, expires_at, permission_grant_id, superadmin_generation_id) values (${randomUUID()}, ${targetId}, ${digest(token)}, ${expiresAt}, ${grants[0].id}, ${role?.generationId ?? null})`;
      await sql`insert into identity_platform_password_recovery_audit (id, actor_identity_id, target_identity_id, action, reason, correlation_id) values (${randomUUID()}, ${actor.identityId}, ${targetId}, 'REQUESTED', ${reason}, ${correlationId})`;
      const [fresh] =
        await sql`select id from identity_sessions where token_hash = ${digest(sessionToken)} and revoked_at is null and expires_at > clock_timestamp()`;
      if (!fresh) throw new PlatformPasswordSessionExpiredError();
      return { code: token, expiresAt: expiresAt.toISOString() };
    });
  }
  async redeemRecovery(code: string, password: string, correlationId: string) {
    return this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext('identity_platform_superadmins'))`;
      const [recovery] = await sql<
        {
          id: string;
          identityId: string;
          permissionGrantId: string | null;
          roleGenerationId: string | null;
        }[]
      >`select id, identity_id as "identityId", permission_grant_id as "permissionGrantId", superadmin_generation_id as "roleGenerationId" from identity_platform_password_recoveries where token_hash = ${digest(code)} and consumed_at is null and expires_at > clock_timestamp() for update`;
      if (!recovery) return false;
      await sql`select pg_advisory_xact_lock(hashtextextended(${recovery.identityId}, 301))`;
      const [target] = await sql<
        { id: string }[]
      >`select i.id from identity_identities i join identity_platform_passwords p on p.identity_id = i.id where i.id = ${recovery.identityId} and i.status = 'ACTIVE' and not exists (select 1 from identity_platform_superadmins a where a.identity_id = i.id and a.revoked_at is null) for share of i, p`;
      if (!target) return false;
      const activeGrants =
        await sql`select id from identity_platform_permission_grants where id = ${recovery.permissionGrantId} and identity_id = ${recovery.identityId} and revoked_at is null for share`;
      const [role] = await sql<
        { generationId: string }[]
      >`select generation_id as "generationId" from identity_platform_superadmins where identity_id = ${recovery.identityId} for share`;
      if (
        !activeGrants.length ||
        (role?.generationId ?? null) !== recovery.roleGenerationId
      )
        return false;
      let admitted = false;
      for (let slot = 0; slot < 4; slot++) {
        const [capacity] = await sql<
          { acquired: boolean }[]
        >`select pg_try_advisory_xact_lock(hashtextextended('platform-password-work', 276) + ${slot}) as acquired`;
        if (capacity?.acquired) {
          admitted = true;
          break;
        }
      }
      if (!admitted) throw new PlatformPasswordBusyError();
      const hash = await encodePassword(password);
      const consumed =
        await sql`update identity_platform_password_recoveries set consumed_at = clock_timestamp() where id = ${recovery.id} and consumed_at is null and expires_at > clock_timestamp() returning id`;
      if (!consumed.length) return false;
      await sql`update identity_platform_passwords set password_hash = ${hash}, changed_at = clock_timestamp() where identity_id = ${recovery.identityId}`;
      await sql`update identity_sessions set revoked_at = clock_timestamp() where identity_id = ${recovery.identityId} and audience = 'PLATFORM_AGENT' and revoked_at is null`;
      await sql`insert into identity_platform_password_recovery_audit (id, target_identity_id, action, reason, correlation_id) values (${randomUUID()}, ${recovery.identityId}, 'COMPLETED', '', ${correlationId})`;
      return true;
    });
  }
  async revokePublicSessions(
    token: string,
    input: { targetIdentityId: string; incidentId: string; reason: string },
    correlationId: string,
  ) {
    return this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${input.targetIdentityId}, 273))`;
      const [observed] = await sql<
        { identityId: string }[]
      >`select identity_id as "identityId" from identity_sessions where token_hash = ${digest(token)} and audience = 'PLATFORM_AGENT'`;
      if (!observed) return false;
      await sql`select pg_advisory_xact_lock(hashtextextended(${observed.identityId}, 301))`;
      const [session] = await sql<
        { identityId: string }[]
      >`select s.identity_id as "identityId" from identity_sessions s join identity_identities i on i.id = s.identity_id and i.status = 'ACTIVE' where s.token_hash = ${digest(token)} and s.audience = 'PLATFORM_AGENT' and s.platform_auth_method = 'PASSWORD' and s.revoked_at is null and s.expires_at > clock_timestamp() for update of s for share of i`;
      if (!session) return false;
      const grants =
        await sql`select id from identity_platform_permission_grants where identity_id = ${session.identityId} and permission = 'SESSION_SECURITY' and revoked_at is null for share`;
      const roles =
        await sql`select identity_id from identity_platform_superadmins where identity_id = ${session.identityId} and revoked_at is null for share`;
      const authorized = !!(grants.length || roles.length);
      if (!authorized) {
        await sql`insert into identity_session_security_audit (id, actor_identity_id, target_identity_id, action, incident_id, reason, revoked_count, outcome, correlation_id, occurred_at) values (${randomUUID()}, ${session.identityId}, ${input.targetIdentityId}, 'REVOKE_PUBLIC_SESSIONS', ${input.incidentId}, ${input.reason}, 0, 'REJECTED', ${correlationId}, clock_timestamp())`;
        return false;
      }
      const revoked =
        await sql`update identity_sessions set revoked_at = clock_timestamp() where identity_id = ${input.targetIdentityId} and audience = 'PUBLIC' and revoked_at is null returning id`;
      await sql`insert into identity_session_security_audit (id, actor_identity_id, target_identity_id, action, incident_id, reason, revoked_count, outcome, correlation_id, occurred_at) values (${randomUUID()}, ${session.identityId}, ${input.targetIdentityId}, 'REVOKE_PUBLIC_SESSIONS', ${input.incidentId}, ${input.reason}, ${revoked.length}, 'SUCCEEDED', ${correlationId}, clock_timestamp())`;
      const [fresh] =
        await sql`select id from identity_sessions where token_hash = ${digest(token)} and revoked_at is null and expires_at > clock_timestamp()`;
      if (!fresh) throw new Error("Platform session expired during operation");
      return true;
    });
  }
  async onModuleDestroy() {
    await this.#sql.end();
  }
}
