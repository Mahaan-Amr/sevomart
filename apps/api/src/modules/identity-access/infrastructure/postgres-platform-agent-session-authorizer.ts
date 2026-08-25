import { createHash } from "node:crypto";

import postgres, { type Sql } from "postgres";

import {
  PlatformAgentSessionUnauthorizedError,
  PlatformPermissionRequiredError,
  type PlatformAgentActor,
  type PlatformAgentSessionAuthorizer,
} from "../public";

type PlatformSessionRow = {
  identityId: string;
  hasPermission: boolean;
};

export class PostgresPlatformAgentSessionAuthorizer implements PlatformAgentSessionAuthorizer {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async authorizeSellerApplicationReview(token: string) {
    return this.#authorize(token, "SELLER_APPLICATION_REVIEW");
  }

  async authorizePaymentReview(token: string) {
    return this.#authorize(token, "PAYMENT_REVIEW");
  }

  async #authorize<Permission extends "SELLER_APPLICATION_REVIEW" | "PAYMENT_REVIEW">(
    token: string,
    permission: Permission,
  ): Promise<PlatformAgentActor & { permission: Permission }> {
    if (!token) throw new PlatformAgentSessionUnauthorizedError();
    const rows = await this.#sql<PlatformSessionRow[]>`
      select s.identity_id as "identityId",
        exists (
          select 1 from identity_platform_permission_grants g
          where g.identity_id = s.identity_id
            and g.permission = ${permission}
            and g.revoked_at is null
        ) as "hasPermission"
      from identity_sessions s
      join identity_identities i on i.id = s.identity_id
      where s.token_hash = ${hashToken(token)}
        and s.audience = 'PLATFORM_AGENT'
        and s.revoked_at is null
        and s.expires_at > now()
        and i.status = 'ACTIVE'
      limit 1
    `;
    const session = rows[0];
    if (!session) throw new PlatformAgentSessionUnauthorizedError();
    if (!session.hasPermission) throw new PlatformPermissionRequiredError();
    return {
      identityId: session.identityId,
      audience: "PLATFORM_AGENT" as const,
      permission,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.#sql.end();
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
