import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import postgres from "postgres";
import type { IranianMobile, OtpCode } from "@sevo/contracts/identity-access/v1";
import type { OtpProvider } from "../public";

const scryptOptions = { N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 };
function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(password, salt, 64, scryptOptions, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const dummyHash = `scrypt$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(64).toString("base64url")}`;
export class PasswordBusyError extends Error {}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const key = await scrypt(password, salt);
  return `scrypt$${salt}$${key.toString("base64url")}`;
}

async function matchesPassword(password: string, encoded: string) {
  const [, salt, key] = encoded.split("$");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function admitPasswordWork(sql: postgres.TransactionSql) {
  let acquired = false;
  for (let slot = 0; slot < 4; slot++) {
    const [lock] = await sql<
      Array<{ acquired: boolean }>
    >`select pg_try_advisory_xact_lock(hashtextextended('sevo-password-admission-v1', 274) + ${slot}) as acquired`;
    if (lock?.acquired) {
      acquired = true;
      break;
    }
  }
  if (!acquired) return false;
  return true;
}

async function admitVerifiedWork(
  sql: postgres.TransactionSql,
  scope: "enroll" | "reset",
) {
  for (let slot = 0; slot < 4; slot++) {
    const [lock] = await sql<
      Array<{ acquired: boolean }>
    >`select pg_try_advisory_xact_lock(hashtextextended(${`sevo-password-${scope}-v1`}, 274) + ${slot}) as acquired`;
    if (lock?.acquired) return true;
  }
  return false;
}

export class SellerPasswordService {
  readonly #sql: postgres.Sql;
  readonly #verifiedSql: postgres.Sql;
  constructor(
    databaseUrl: string,
    private readonly provider: OtpProvider,
    private readonly allowedMobiles: readonly IranianMobile[] | undefined,
    private readonly createCode: () => OtpCode,
  ) {
    this.#sql = postgres(databaseUrl, { max: 5 });
    this.#verifiedSql = postgres(databaseUrl, { max: 5 });
  }

  async requestRecovery(mobile: IranianMobile, correlationId: string) {
    const id = randomUUID();
    const code = this.createCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const canDeliver = !this.allowedMobiles || this.allowedMobiles.includes(mobile);
    const proof = canDeliver ? code : randomBytes(32).toString("base64url");
    const codeHash = createHash("sha256").update(`${id}:${proof}`).digest("hex");
    const accepted = await this.#sql.begin(async (sql) => {
      const [mobileLock] = await sql<
        Array<{ acquired: boolean }>
      >`select pg_try_advisory_xact_lock(hashtext(${mobile})) as acquired`;
      if (!mobileLock?.acquired) return false;
      const [count] = await sql<
        Array<{ count: number }>
      >`select count(*)::int as count from identity_otp_challenges where mobile = ${mobile} and created_at > clock_timestamp() - interval '10 minutes'`;
      if ((count?.count ?? 0) >= 20) return false;
      await sql`insert into identity_otp_challenges (id, mobile, code_hash, provider_reference, expires_at, audience) values (${id}, ${mobile}, ${codeHash}, 'pending', ${expiresAt}, 'PASSWORD_RESET')`;
      return true;
    });
    if (!accepted) return undefined;
    const receipt = canDeliver
      ? await this.provider.deliverOtp({ mobile, code, expiresAt, correlationId })
      : { providerReference: "suppressed" };
    await this
      .#sql`update identity_otp_challenges set provider_reference = ${receipt.providerReference} where id = ${id} and audience = 'PASSWORD_RESET'`;
    return { challengeId: id, expiresAt: expiresAt.toISOString() };
  }

  async reset(challengeId: string, code: string, password: string) {
    const codeHash = createHash("sha256")
      .update(`${challengeId}:${code}`)
      .digest("hex");
    return this.#verifiedSql.begin(async (sql) => {
      const [challenge] = await sql<
        Array<{ mobile: string }>
      >`select mobile from identity_otp_challenges where id = ${challengeId} and audience = 'PASSWORD_RESET'`;
      if (!challenge) return false;
      const [mobileLock] = await sql<
        Array<{ acquired: boolean }>
      >`select pg_try_advisory_xact_lock(hashtext(${challenge.mobile})) as acquired`;
      if (!mobileLock?.acquired) throw new PasswordBusyError();
      const [attempt] = await sql<Array<{ attempts: number }>>`
        select (coalesce((select sum(verification_attempts) from identity_otp_challenges where mobile = ${challenge.mobile} and audience = 'PASSWORD_RESET' and created_at > clock_timestamp() - interval '15 minutes'), 0) + 1)::int as attempts`;
      const [proof] = await sql<
        Array<{ matches: boolean }>
      >`update identity_otp_challenges set verification_attempts = verification_attempts + 1,
        consumed_at = case when code_hash = ${codeHash} and ${attempt?.attempts ?? 11} <= 10 then clock_timestamp() else null end
        where id = ${challengeId} and audience = 'PASSWORD_RESET' and consumed_at is null and expires_at > clock_timestamp() and verification_attempts < 5
        returning code_hash = ${codeHash} and ${attempt?.attempts ?? 11} <= 10 as matches`;
      if (!proof?.matches) return false;
      const [identity] = await sql<
        Array<{ id: string }>
      >`select i.id from identity_login_methods m join identity_identities i on i.id = m.identity_id and i.status = 'ACTIVE'
        join identity_seller_access a on a.identity_id = i.id and a.status = 'ACTIVE'
        join identity_seller_passwords p on p.identity_id = i.id where m.mobile = ${challenge.mobile} and m.kind = 'MOBILE'`;
      if (!identity) return false;
      await sql`select pg_advisory_xact_lock(hashtextextended(${identity.id}, 273))`;
      const stillValid =
        await sql`select id from identity_otp_challenges where id = ${challengeId} and audience = 'PASSWORD_RESET' and code_hash = ${codeHash} and consumed_at is not null and expires_at > clock_timestamp()`;
      if (!stillValid.length) return false;
      if (!(await admitVerifiedWork(sql, "reset"))) throw new PasswordBusyError();
      const encoded = await hashPassword(password);
      const validAfterHash =
        await sql`select id from identity_otp_challenges where id = ${challengeId} and audience = 'PASSWORD_RESET' and code_hash = ${codeHash} and consumed_at is not null and expires_at > clock_timestamp()`;
      if (!validAfterHash.length) return false;
      const changed =
        await sql`update identity_seller_passwords p set password_hash = ${encoded}, changed_at = clock_timestamp()
        where p.identity_id = ${identity.id} and exists (select 1 from identity_identities i join identity_seller_access a on a.identity_id = i.id where i.id = p.identity_id and i.status = 'ACTIVE' and a.status = 'ACTIVE') returning identity_id`;
      if (!changed.length) return false;
      await sql`update identity_otp_challenges set code_hash = repeat('0', 64), consumed_at = coalesce(consumed_at, clock_timestamp()) where mobile = ${challenge.mobile} and audience in ('PUBLIC', 'PASSWORD_RESET')`;
      await sql`update identity_sessions set revoked_at = clock_timestamp() where identity_id = ${identity.id} and audience = 'PUBLIC' and revoked_at is null`;
      await sql`delete from identity_password_attempts where mobile = ${challenge.mobile}`;
      return true;
    });
  }

  async enroll(token: string, password: string) {
    return this.#verifiedSql.begin(async (sql) => {
      const [session] = await sql<
        Array<{ identityId: string }>
      >`select identity_id as "identityId" from identity_sessions where token_hash = ${hashToken(token)} and audience = 'PUBLIC'`;
      if (!session) return false;
      await sql`select pg_advisory_xact_lock(hashtextextended(${session.identityId}, 273))`;
      const eligible =
        await sql`select i.id from identity_identities i join identity_sessions s on s.identity_id = i.id
        join identity_seller_access a on a.identity_id = i.id
        where i.id = ${session.identityId} and i.status = 'ACTIVE' and a.status = 'ACTIVE'
          and s.token_hash = ${hashToken(token)} and s.audience = 'PUBLIC' and s.revoked_at is null
          and s.expires_at > clock_timestamp() and s.created_at + interval '90 days' > clock_timestamp()
          and not exists (select 1 from identity_seller_passwords p where p.identity_id = i.id)`;
      if (!eligible.length) return false;
      if (!(await admitVerifiedWork(sql, "enroll"))) throw new PasswordBusyError();
      const encoded = await hashPassword(password);
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
      const [mobileLock] = await sql<
        Array<{ acquired: boolean }>
      >`select pg_try_advisory_xact_lock(hashtext(${mobile})) as acquired`;
      if (!mobileLock?.acquired) throw new PasswordBusyError();
      if (!(await admitPasswordWork(sql))) throw new PasswordBusyError();
      const [cleanup] = await sql<
        Array<{ acquired: boolean }>
      >`select pg_try_advisory_xact_lock(hashtextextended('sevo-password-cleanup-v1', 274)) as acquired`;
      if (cleanup?.acquired)
        await sql`delete from identity_password_attempts where mobile in (select mobile from identity_password_attempts where window_started_at <= clock_timestamp() - interval '15 minutes' order by window_started_at limit 100 for update skip locked)`;
      const [credential] = await sql<
        Array<{ identityId: string; passwordHash: string }>
      >`
        select i.id as "identityId", p.password_hash as "passwordHash" from identity_login_methods m
        join identity_identities i on i.id = m.identity_id and i.status = 'ACTIVE'
        join identity_seller_access a on a.identity_id = i.id and a.status = 'ACTIVE'
        join identity_seller_passwords p on p.identity_id = i.id where m.mobile = ${mobile} and m.kind = 'MOBILE'`;
      const [capacity] = await sql<
        Array<{ allowed: boolean }>
      >`select exists(select 1 from identity_password_attempts where mobile = ${mobile}) or (select count(*) from identity_password_attempts) < 10000 as allowed`;
      if (!capacity?.allowed && !credential) {
        const evicted = cleanup?.acquired
          ? await sql`delete from identity_password_attempts where mobile in (
          select a.mobile from identity_password_attempts a where not exists (
            select 1 from identity_login_methods m join identity_identities i on i.id = m.identity_id and i.status = 'ACTIVE'
            join identity_seller_access s on s.identity_id = i.id and s.status = 'ACTIVE'
            join identity_seller_passwords p on p.identity_id = i.id where m.mobile = a.mobile and m.kind = 'MOBILE'
          ) order by a.window_started_at limit 1 for update skip locked
        ) returning mobile`
          : [];
        if (!evicted.length) {
          await matchesPassword(password, dummyHash);
          return undefined;
        }
      }
      const [attempt] = await sql<Array<{ attempts: number }>>`
        insert into identity_password_attempts (mobile, attempts, window_started_at)
        values (${mobile}, 1, clock_timestamp())
        on conflict (mobile) do update set
          attempts = case when identity_password_attempts.window_started_at < clock_timestamp() - interval '15 minutes' then 1 else least(identity_password_attempts.attempts + 1, 11) end,
          window_started_at = case when identity_password_attempts.window_started_at < clock_timestamp() - interval '15 minutes' then clock_timestamp() else identity_password_attempts.window_started_at end
        returning attempts`;
      if (!attempt || attempt.attempts > 10) {
        await matchesPassword(password, dummyHash);
        return undefined;
      }
      const valid = await matchesPassword(
        password,
        credential?.passwordHash ?? dummyHash,
      );
      if (!credential || !valid) return undefined;
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
    await this.#verifiedSql.end();
  }
}
