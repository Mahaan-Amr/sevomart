import type { IranianMobile } from "@sevo/contracts/identity-access/v1";
import postgres, { type Sql } from "postgres";

import type {
  IdentityAccessRepository,
  SellerIdentity,
  StoredOtpChallenge,
} from "../public";

export class PostgresIdentityAccessRepository implements IdentityAccessRepository {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async saveChallenge(challenge: StoredOtpChallenge): Promise<void> {
    await this.#sql`
      insert into identity_otp_challenges
        (id, mobile, code_hash, provider_reference, expires_at)
      values
        (${challenge.id}, ${challenge.mobile}, ${challenge.codeHash},
         ${challenge.providerReference}, ${challenge.expiresAt})
    `;
  }

  async consumeValidChallenge(
    challengeId: string,
    codeHash: string,
    now: Date,
  ): Promise<IranianMobile | undefined> {
    const rows = await this.#sql<Array<{ mobile: IranianMobile }>>`
      update identity_otp_challenges
      set consumed_at = ${now}
      where id = ${challengeId}
        and code_hash = ${codeHash}
        and consumed_at is null
        and expires_at > ${now}
      returning mobile
    `;
    return rows[0]?.mobile;
  }

  async findOrCreateSeller(mobile: IranianMobile): Promise<SellerIdentity> {
    const rows = await this.#sql<Array<SellerIdentity>>`
      insert into identity_sellers (id, mobile)
      values (${crypto.randomUUID()}, ${mobile})
      on conflict (mobile) do update set mobile = excluded.mobile
      returning id, mobile
    `;
    const seller = rows[0];
    if (!seller) throw new Error("Seller upsert did not return a row");
    return seller;
  }

  async saveSession(session: {
    id: string;
    tokenHash: string;
    sellerId: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.#sql`
      insert into identity_seller_sessions
        (id, token_hash, seller_id, expires_at)
      values
        (${session.id}, ${session.tokenHash}, ${session.sellerId}, ${session.expiresAt})
    `;
  }

  async onModuleDestroy(): Promise<void> {
    await this.#sql.end();
  }
}
