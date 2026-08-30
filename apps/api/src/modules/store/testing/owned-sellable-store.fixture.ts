import { randomUUID } from "node:crypto";

import type { IdentityId, StoreId } from "@sevo/contracts/platform/v1";
import postgres from "postgres";

export async function createOwnedSellableStoreFixture(
  databaseUrl: string,
  input: { sellerId: IdentityId; storeId: StoreId },
) {
  const sql = postgres(databaseUrl, { max: 1 });
  await sql`
    insert into store_stores
      (id, name, status, revision, publication_version, published_at,
       settlement_kind, settlement_status, settlement_verified_at)
    values
      (${input.storeId}, 'فروشگاه محتوای آزمون', 'PUBLISHED', 1, 1, now(),
       'TEST', 'TEST_VERIFIED', now())
  `;
  await sql`
    insert into store_memberships (id, store_id, seller_id, role)
    values (${randomUUID()}, ${input.storeId}, ${input.sellerId}, 'OWNER')
  `;

  return {
    async cleanup() {
      try {
        await sql`delete from store_stores where id = ${input.storeId}`;
      } finally {
        await sql.end();
      }
    },
  };
}
