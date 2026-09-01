import { randomUUID } from "node:crypto";

import type { IdentityId } from "@sevo/contracts/platform/v1";
import postgres from "postgres";

export async function createActiveSellerFixture(
  databaseUrl: string,
  identityId: IdentityId,
) {
  const sql = postgres(databaseUrl, { max: 1 });
  const [previous] = await sql<Array<{ id: string; status: string }>>`
    select id, status from identity_seller_access where identity_id = ${identityId}
  `;
  await sql`
    insert into identity_seller_access (id, identity_id, status)
    values (${randomUUID()}, ${identityId}, 'ACTIVE')
    on conflict (identity_id) do update set status = 'ACTIVE'
  `;

  return {
    async cleanup() {
      try {
        if (previous) {
          await sql`
            update identity_seller_access set status = ${previous.status}
            where id = ${previous.id}
          `;
        } else {
          await sql`delete from identity_seller_access where identity_id = ${identityId}`;
        }
      } finally {
        await sql.end();
      }
    },
  };
}
