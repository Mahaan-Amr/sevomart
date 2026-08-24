import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  IranianMobile,
  OtpChallenge,
  OtpChallengeId,
  OtpCode,
} from "@sevo/contracts/identity-access/v1";
import postgres, { type Sql } from "postgres";

import type { OtpProvider } from "../public";
import { OtpRejectedError, OtpRequestRateLimitedError } from "./identity-otp.service";
import { PlatformPermissionRequiredError } from "../public";

const CHALLENGE_LIFETIME_MS = 10 * 60 * 1_000;
const REQUEST_WINDOW_MS = 10 * 60 * 1_000;
const REQUEST_LIMIT = 20;
const MAX_ATTEMPTS = 5;
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1_000;

export class PlatformAgentOtpService {
  readonly #sql: Sql;

  constructor(
    databaseUrl: string,
    private readonly provider: OtpProvider,
    private readonly createOtpCode: () => OtpCode,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async requestOtp(
    mobile: IranianMobile,
    correlationId: string,
  ): Promise<OtpChallenge> {
    const granted = await this.#sql<Array<{ identityId: string }>>`
      select i.id as "identityId"
      from identity_login_methods lm
      join identity_identities i on i.id = lm.identity_id and i.status = 'ACTIVE'
      join identity_platform_permission_grants g
        on g.identity_id = i.id
       and g.permission = 'SELLER_APPLICATION_REVIEW'
       and g.revoked_at is null
      where lm.kind = 'MOBILE' and lm.mobile = ${mobile}
      limit 1
    `;
    if (!granted[0]) throw new PlatformPermissionRequiredError();

    const challengeId = randomUUID() as OtpChallengeId;
    const code = this.createOtpCode();
    const occurredAt = this.now();
    const expiresAt = new Date(occurredAt.getTime() + CHALLENGE_LIFETIME_MS);
    const accepted = await this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext(${`platform:${mobile}`}))`;
      const counts = await sql<Array<{ count: number }>>`
        select count(*)::int as count from identity_otp_challenges
        where mobile = ${mobile} and audience = 'PLATFORM_AGENT'
          and created_at >= ${new Date(occurredAt.getTime() - REQUEST_WINDOW_MS)}
      `;
      if ((counts[0]?.count ?? 0) >= REQUEST_LIMIT) return false;
      await sql`
        insert into identity_otp_challenges
          (id, mobile, code_hash, provider_reference, expires_at, audience)
        values (${challengeId}, ${mobile}, ${hashChallengeCode(challengeId, code)},
          'pending', ${expiresAt}, 'PLATFORM_AGENT')
      `;
      return true;
    });
    if (!accepted) throw new OtpRequestRateLimitedError();

    const receipt = await this.provider.deliverOtp({
      mobile,
      code,
      expiresAt,
      correlationId,
    });
    await this.#sql`
      update identity_otp_challenges set provider_reference = ${receipt.providerReference}
      where id = ${challengeId} and audience = 'PLATFORM_AGENT'
    `;
    return { challengeId, expiresAt: expiresAt.toISOString() };
  }

  async verifyOtp(challengeId: OtpChallengeId, code: OtpCode) {
    return this.#sql.begin(async (sql) => {
      const challenges = await sql<
        Array<{ mobile: IranianMobile; codeHash: string; attempts: number }>
      >`
        select mobile, code_hash as "codeHash", verification_attempts as attempts
        from identity_otp_challenges
        where id = ${challengeId} and audience = 'PLATFORM_AGENT'
          and consumed_at is null and expires_at > ${this.now()}
        for update
      `;
      const challenge = challenges[0];
      if (
        !challenge ||
        challenge.attempts >= MAX_ATTEMPTS ||
        challenge.codeHash !== hashChallengeCode(challengeId, code)
      ) {
        if (challenge) {
          await sql`update identity_otp_challenges
            set verification_attempts = verification_attempts + 1
            where id = ${challengeId}`;
        }
        throw new OtpRejectedError();
      }

      const identities = await sql<Array<{ identityId: string }>>`
        select i.id as "identityId"
        from identity_login_methods lm
        join identity_identities i on i.id = lm.identity_id and i.status = 'ACTIVE'
        join identity_platform_permission_grants g
          on g.identity_id = i.id
         and g.permission = 'SELLER_APPLICATION_REVIEW'
         and g.revoked_at is null
        where lm.kind = 'MOBILE' and lm.mobile = ${challenge.mobile}
        for share of g
      `;
      const identity = identities[0];
      if (!identity) throw new PlatformPermissionRequiredError();

      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(this.now().getTime() + SESSION_LIFETIME_MS);
      await sql`update identity_otp_challenges set consumed_at = ${this.now()},
        verification_attempts = verification_attempts + 1 where id = ${challengeId}`;
      await sql`
        insert into identity_sessions
          (id, token_hash, identity_id, audience, expires_at)
        values (${randomUUID()}, ${hashToken(token)}, ${identity.identityId},
          'PLATFORM_AGENT', ${expiresAt})
      `;
      return {
        token,
        session: {
          actor: {
            identityId: identity.identityId,
            audience: "PLATFORM_AGENT" as const,
          },
          permission: "SELLER_APPLICATION_REVIEW" as const,
          expiresAt: expiresAt.toISOString(),
        },
      };
    });
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

function hashChallengeCode(challengeId: string, code: string): string {
  return createHash("sha256").update(`${challengeId}:${code}`).digest("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
