import { randomUUID } from "node:crypto";
import { identityIdContract, storeIdContract } from "@sevo/contracts/platform/v1";
import { storeAuthoritativeSnapshotV1Contract } from "@sevo/contracts/store/v1";
import postgres from "postgres";
import { expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { StoreService } from "../../apps/api/src/modules/store/application/store.service";
import { STORE_SERVICE } from "../../apps/api/src/modules/store/store.tokens";
import {
  STORE_AUTHORITATIVE_READ,
  type StoreAuthoritativeRead,
} from "../../apps/api/src/modules/store/public";
import { createOpaqueStoreTransactionContext } from "../../apps/api/src/modules/store/infrastructure/opaque-store-transaction";
import { apiTestEnvironment } from "../helpers/api-test-environment";

it("composes current seller eligibility from identity-access without changing Store history", async () => {
  const app = await createApiApp(apiTestEnvironment);
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const ownerId = identityIdContract.parse(randomUUID());
  let storeId: ReturnType<typeof storeIdContract.parse> | undefined;
  try {
    const saved = await app.get<StoreService>(STORE_SERVICE).saveDraft(
      ownerId,
      { name: "خانه سفال ماه" },
      {
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        expectedRevision: 0,
      },
    );
    storeId = storeIdContract.parse(saved.id);
    const reads = app.get<StoreAuthoritativeRead>(STORE_AUTHORITATIVE_READ);
    const initial = await reads.readStore(storeId);
    expect(initial).toMatchObject({
      revision: 1,
      publicationStatus: "DRAFT",
      sellerAccess: { active: false },
    });
    await sql`insert into identity_seller_access (id, identity_id, status) values (${randomUUID()}, ${ownerId}, 'ACTIVE')`;
    const active = await reads.readOwnedStore(ownerId);
    expect(active).toMatchObject({
      revision: 1,
      publicationStatus: "DRAFT",
      sellerAccess: { active: true },
    });
    expect(storeAuthoritativeSnapshotV1Contract.parse(active)).toEqual(active);
    for (const status of ["SUSPENDED", "REVOKED"]) {
      await sql`update identity_seller_access set status = ${status} where identity_id = ${ownerId}`;
      expect(await reads.readStore(storeId)).toMatchObject({
        revision: 1,
        sellerAccess: { active: false },
      });
    }
    const transactionStoreId = storeId;
    await sql.begin(async (transaction) => {
      expect(
        await reads.readStoreInTransaction!(
          createOpaqueStoreTransactionContext(transaction),
          transactionStoreId,
        ),
      ).toEqual(initial);
    });
  } finally {
    if (storeId) await sql`delete from store_stores where id = ${storeId}`;
    await sql`delete from store_idempotency_records where actor_identity_id = ${ownerId}`;
    await sql`delete from identity_seller_access where identity_id = ${ownerId}`;
    await sql.end();
    await app.close();
  }
});
