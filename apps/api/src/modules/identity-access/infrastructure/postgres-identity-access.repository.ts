import { randomUUID } from "node:crypto";

import type { IranianMobile } from "@sevo/contracts/identity-access/v1";
import type { IdentityId } from "@sevo/contracts/platform/v1";
import postgres, { type Sql } from "postgres";

import type {
  IdentityAccessRepository,
  SellerAccessRead,
  SevoIdentity,
  StoredIdentitySession,
  StoredOtpChallenge,
} from "../public";

const MAX_OTP_VERIFICATION_ATTEMPTS = 5;

export class PostgresIdentityAccessRepository
  implements IdentityAccessRepository, SellerAccessRead
{
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async saveChallengeIfAllowed(
    challenge: StoredOtpChallenge,
    since: Date,
    limit: number,
  ): Promise<boolean> {
    return this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext(${challenge.mobile}))`;
      const rows = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from identity_otp_challenges
        where mobile = ${challenge.mobile} and created_at >= ${since}
      `;
      if ((rows[0]?.count ?? 0) >= limit) return false;
      await sql`
        insert into identity_otp_challenges
          (id, mobile, code_hash, provider_reference, expires_at)
        values
          (${challenge.id}, ${challenge.mobile}, ${challenge.codeHash},
           ${challenge.providerReference}, ${challenge.expiresAt})
      `;
      return true;
    });
  }

  async updateChallengeProviderReference(
    challengeId: string,
    providerReference: string,
  ): Promise<void> {
    await this.#sql`
      update identity_otp_challenges
      set provider_reference = ${providerReference}
      where id = ${challengeId}
        and audience = 'PUBLIC'
    `;
  }

  async consumeValidChallenge(
    challengeId: string,
    codeHash: string,
    now: Date,
  ): Promise<IranianMobile | undefined> {
    const rows = await this.#sql<
      Array<{ mobile: IranianMobile; codeMatches: boolean }>
    >`
      update identity_otp_challenges
      set verification_attempts = verification_attempts + 1,
          consumed_at = case when code_hash = ${codeHash} then ${now} else null end
      where id = ${challengeId}
        and audience = 'PUBLIC'
        and consumed_at is null
        and expires_at > ${now}
        and verification_attempts < ${MAX_OTP_VERIFICATION_ATTEMPTS}
      returning mobile, code_hash = ${codeHash} as "codeMatches"
    `;
    return rows[0]?.codeMatches ? rows[0].mobile : undefined;
  }

  async findOrCreateIdentity(mobile: IranianMobile): Promise<SevoIdentity> {
    return this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext(${mobile}))`;
      const existing = await sql<Array<SevoIdentity>>`
        select i.id
        from identity_login_methods lm
        join identity_identities i on i.id = lm.identity_id
        where lm.kind = 'MOBILE' and lm.mobile = ${mobile}
        limit 1
      `;
      if (existing[0]) return existing[0];

      const identity = { id: randomUUID() };
      await sql`
        insert into identity_identities (id, status)
        values (${identity.id}, 'ACTIVE')
      `;
      await sql`
        insert into identity_login_methods
          (id, identity_id, kind, mobile, verified_at)
        values (${randomUUID()}, ${identity.id}, 'MOBILE', ${mobile}, now())
      `;
      return identity;
    });
  }

  async saveSession(session: StoredIdentitySession): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${session.identityId}, 273))`;
      await sql`
      insert into identity_sessions
        (id, token_hash, identity_id, audience, expires_at)
      values
        (${session.id}, ${session.tokenHash}, ${session.identityId},
         ${session.audience}, ${session.expiresAt})
    `;
    });
  }

  async findActiveSession(tokenHash: string, now: Date) {
    const rows = await this.#sql<
      Array<{ identityId: string; mobile: IranianMobile; expiresAt: Date }>
    >`
      with touched as (
        update identity_sessions s
        set expires_at = least(s.created_at + interval '90 days', greatest(s.expires_at, ${now}::timestamptz + interval '7 days'))
        where s.token_hash = ${tokenHash} and s.audience = 'PUBLIC'
          and s.revoked_at is null and s.expires_at > ${now}
          and s.created_at + interval '90 days' > ${now}
          and exists (select 1 from identity_identities i where i.id = s.identity_id and i.status = 'ACTIVE')
        returning s.*
      )
      select i.id as "identityId", login.mobile, s.expires_at as "expiresAt"
      from touched s
      join identity_identities i on i.id = s.identity_id
      join identity_login_methods login on login.identity_id = i.id
        and login.kind = 'MOBILE'
      where s.token_hash = ${tokenHash}
        and s.audience = 'PUBLIC'
        and s.revoked_at is null
        and s.expires_at > ${now}
        and i.status = 'ACTIVE'
      limit 1
    `;
    return rows[0];
  }

  async findSession(tokenHash: string, now: Date) {
    const rows = await this.#sql<
      Array<{
        identityId: string;
        mobile: IranianMobile;
        expiresAt: Date;
        identityStatus: "ACTIVE" | "INACTIVE";
      }>
    >`
      with touched as (
        update identity_sessions s
        set expires_at = case when exists (select 1 from identity_identities i where i.id = s.identity_id and i.status = 'ACTIVE')
          then least(s.created_at + interval '90 days', greatest(s.expires_at, ${now}::timestamptz + interval '7 days'))
          else s.expires_at end
        where s.token_hash = ${tokenHash} and s.audience = 'PUBLIC'
          and s.revoked_at is null and s.expires_at > ${now}
          and s.created_at + interval '90 days' > ${now}
        returning s.*
      )
      select i.id as "identityId", login.mobile, s.expires_at as "expiresAt",
        i.status as "identityStatus"
      from touched s
      join identity_identities i on i.id = s.identity_id
      join identity_login_methods login on login.identity_id = i.id
        and login.kind = 'MOBILE'
      where s.token_hash = ${tokenHash}
        and s.audience = 'PUBLIC'
        and s.revoked_at is null
        and s.expires_at > ${now}
      limit 1
    `;
    return rows[0];
  }

  async isActiveSeller(identityId: IdentityId): Promise<boolean> {
    const rows = await this.#sql<Array<{ active: boolean }>>`
      select exists(
        select 1 from identity_seller_access
        where identity_id = ${identityId} and status = 'ACTIVE'
      ) as active
    `;
    return rows[0]?.active ?? false;
  }

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<boolean> {
    const rows = await this.#sql<Array<{ id: string }>>`
      update identity_sessions
      set revoked_at = ${revokedAt}
      where token_hash = ${tokenHash} and revoked_at is null
      returning id
    `;
    return rows.length > 0;
  }

  async revokeAllSessions(tokenHash: string, revokedAt: Date): Promise<boolean> {
    return this.#sql.begin(async (sql) => {
      const identities = await sql<Array<{ identityId: string }>>`
        select identity_id as "identityId" from identity_sessions
        where token_hash = ${tokenHash} and audience = 'PUBLIC'
      `;
      const identityId = identities[0]?.identityId;
      if (!identityId) return false;
      await sql`select pg_advisory_xact_lock(hashtextextended(${identityId}, 273))`;
      const rows = await sql<Array<{ id: string }>>`
        update identity_sessions set revoked_at = ${revokedAt}
        where audience = 'PUBLIC' and revoked_at is null and identity_id = ${identityId}
          and exists (
            select 1 from identity_sessions current_session
            join identity_identities i on i.id = current_session.identity_id
            where current_session.token_hash = ${tokenHash}
              and current_session.audience = 'PUBLIC' and current_session.revoked_at is null
              and current_session.expires_at > ${revokedAt}
              and current_session.created_at + interval '90 days' > ${revokedAt}
              and i.status = 'ACTIVE'
          ) returning id
      `;
      return rows.length > 0;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.#sql.end();
  }
}
