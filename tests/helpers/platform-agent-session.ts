import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { BrowserContext } from "@playwright/test";
import type {
  IranianMobile,
  PlatformPermission,
} from "@sevo/contracts/identity-access/v1";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";

export async function establishPlatformAgentSession(
  context: BrowserContext,
  permissions: readonly PlatformPermission[],
) {
  const token = randomBytes(32).toString("base64url");
  const identityId = await seedPlatformAgent({ permissions, sessionToken: token });
  await context.addCookies([
    {
      name: "sevo_platform_session",
      value: token,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);

  return {
    identityId,
    async revoke(permission: PlatformPermission) {
      const revokeSql = postgres(databaseUrl, { max: 1 });
      try {
        await revokeSql`
          update identity_platform_permission_grants
          set revoked_at = now()
          where identity_id = ${identityId}
            and permission = ${permission}
            and revoked_at is null
        `;
      } finally {
        await revokeSql.end();
      }
    },
  };
}

export async function establishPlatformAgentIdentity(
  mobile: IranianMobile,
  permissions: readonly PlatformPermission[],
) {
  return seedPlatformAgent({ mobile, permissions });
}

async function seedPlatformAgent({
  mobile,
  permissions,
  sessionToken,
}: {
  mobile?: IranianMobile;
  permissions: readonly PlatformPermission[];
  sessionToken?: string;
}) {
  const identityId = randomUUID();
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.begin(async (transaction) => {
      await transaction`
        insert into identity_identities (id, status)
        values (${identityId}, 'ACTIVE')
      `;
      if (mobile) {
        await transaction`
          insert into identity_login_methods
            (id, identity_id, kind, mobile, verified_at)
          values (${randomUUID()}, ${identityId}, 'MOBILE', ${mobile}, now())
        `;
      }
      if (sessionToken) {
        await transaction`
          insert into identity_sessions
            (id, token_hash, identity_id, audience, expires_at)
          values
            (${randomUUID()}, ${hash(sessionToken)}, ${identityId}, 'PLATFORM_AGENT',
             now() + interval '1 hour')
        `;
      }
      for (const permission of permissions) {
        await transaction`
          insert into identity_platform_permission_grants
            (id, identity_id, permission, granted_at)
          values (${randomUUID()}, ${identityId}, ${permission}, now())
        `;
      }
    });
  } finally {
    await sql.end();
  }
  return identityId;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
