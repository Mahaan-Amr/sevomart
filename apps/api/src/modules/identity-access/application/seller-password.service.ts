import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import postgres from "postgres";

const scrypt = promisify(scryptCallback);
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const dummyHash = `scrypt$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(64).toString("base64url")}`;

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("base64url")}`;
}

async function matchesPassword(password: string, encoded: string) {
  const [, salt, key] = encoded.split("$");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class SellerPasswordService {
  readonly #sql: postgres.Sql;
  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async enroll(token: string, password: string) {
    const encoded = await hashPassword(password);
    return this.#sql.begin(async (sql) => {
      const [session] = await sql<
        Array<{ identityId: string }>
      >`select identity_id as "identityId" from identity_sessions where token_hash = ${hashToken(token)} and audience = 'PUBLIC'`;
      if (!session) return false;
      await sql`select pg_advisory_xact_lock(hashtextextended(${session.identityId}, 273))`;
      const rows =
        await sql`insert into identity_seller_passwords (identity_id, password_hash)
        select i.id, ${encoded} from identity_identities i
        join identity_sessions s on s.identity_id = i.id
        join identity_seller_access a on a.identity_id = i.id
        where i.id = ${session.identityId} and i.status = 'ACTIVE' and a.status = 'ACTIVE'
          and s.token_hash = ${hashToken(token)} and s.audience = 'PUBLIC' and s.revoked_at is null
          and s.expires_at > clock_timestamp() and s.created_at + interval '90 days' > clock_timestamp()
        on conflict (identity_id) do nothing returning identity_id`;
      return rows.length === 1;
    });
  }

  async login(mobile: string, password: string) {
    return this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext(${mobile}))`;
      const [attempt] = await sql<Array<{ attempts: number }>>`
        insert into identity_password_attempts (mobile, attempts, window_started_at)
        values (${mobile}, 1, clock_timestamp())
        on conflict (mobile) do update set
          attempts = case when identity_password_attempts.window_started_at < clock_timestamp() - interval '15 minutes' then 1 else identity_password_attempts.attempts + 1 end,
          window_started_at = case when identity_password_attempts.window_started_at < clock_timestamp() - interval '15 minutes' then clock_timestamp() else identity_password_attempts.window_started_at end
        returning attempts`;
      const [credential] = await sql<
        Array<{ identityId: string; passwordHash: string }>
      >`
        select i.id as "identityId", p.password_hash as "passwordHash" from identity_login_methods m
        join identity_identities i on i.id = m.identity_id and i.status = 'ACTIVE'
        join identity_seller_access a on a.identity_id = i.id and a.status = 'ACTIVE'
        join identity_seller_passwords p on p.identity_id = i.id where m.mobile = ${mobile} and m.kind = 'MOBILE'`;
      const valid = await matchesPassword(
        password,
        credential?.passwordHash ?? dummyHash,
      );
      if (!credential || !valid || !attempt || attempt.attempts > 10) return undefined;
      await sql`select pg_advisory_xact_lock(hashtextextended(${credential.identityId}, 273))`;
      const [current] = await sql<Array<{ passwordHash: string }>>`
        select p.password_hash as "passwordHash" from identity_seller_passwords p
        join identity_identities i on i.id = p.identity_id and i.status = 'ACTIVE'
        join identity_seller_access a on a.identity_id = i.id and a.status = 'ACTIVE'
        where p.identity_id = ${credential.identityId}`;
      if (current?.passwordHash !== credential.passwordHash) return undefined;
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await sql`insert into identity_sessions (id, token_hash, identity_id, audience, expires_at) values (${randomUUID()}, ${hashToken(token)}, ${credential.identityId}, 'PUBLIC', ${expiresAt})`;
      await sql`delete from identity_password_attempts where mobile = ${mobile}`;
      return {
        token,
        session: {
          actor: { identityId: credential.identityId, audience: "PUBLIC" },
          maskedMobile: `${mobile.slice(0, 4)}***${mobile.slice(-4)}`,
          expiresAt: expiresAt.toISOString(),
        },
      };
    });
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}
