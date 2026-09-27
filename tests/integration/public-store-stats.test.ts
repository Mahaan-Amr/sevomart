import { randomUUID } from "node:crypto";

import { orderItemIdContract } from "@sevo/contracts/orders/v1";
import {
  identityIdContract,
  productIdContract,
  storeIdContract,
} from "@sevo/contracts/platform/v1";
import postgres from "postgres";
import { expect, it } from "vitest";

import { PostgresContentRepository } from "../../apps/api/src/modules/content/composition";
import { PostgresVerifiedPurchaseCountReader } from "../../apps/api/src/modules/orders/composition";
import { createPaidOrderItemFixture } from "../../apps/api/src/modules/orders/testing/paid-order-item.fixture";
import { apiTestEnvironment } from "../helpers/api-test-environment";

it("counts each paid delivered order once and publishes rating only after three experiences", async () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const orders = new PostgresVerifiedPurchaseCountReader(
    apiTestEnvironment.DATABASE_URL,
  );
  const content = new PostgresContentRepository(apiTestEnvironment.DATABASE_URL);
  const buyerId = identityIdContract.parse(randomUUID());
  const storeId = storeIdContract.parse(randomUUID());
  const otherStoreId = storeIdContract.parse(randomUUID());
  const productId = productIdContract.parse(randomUUID());
  const fixtures = [] as Awaited<ReturnType<typeof createPaidOrderItemFixture>>[];
  const experienceIds: string[] = [];
  try {
    expect(await orders.readVerifiedPurchaseCount(storeId)).toEqual({
      count: 0,
      updatedAt: null,
    });
    expect(await content.readPublicStoreRating(storeId)).toBeNull();

    for (const owner of [storeId, storeId, otherStoreId]) {
      fixtures.push(
        await createPaidOrderItemFixture(apiTestEnvironment.DATABASE_URL, {
          buyerId,
          storeId: owner,
          productId,
          orderItemId: orderItemIdContract.parse(randomUUID()),
        }),
      );
    }
    await sql`
      insert into order_items
        (id, order_id, variant_id, product_id, name, quantity,
         unit_price_amount, publication_version)
      values (${randomUUID()}, ${fixtures[0]!.orderId}, ${randomUUID()},
        ${productId}, 'قلم دوم همان سفارش', 1, 1000, 1)
    `;
    expect((await orders.readVerifiedPurchaseCount(storeId)).count).toBe(2);
    expect((await orders.readVerifiedPurchaseCount(otherStoreId)).count).toBe(1);

    await sql`update order_orders set status = 'CANCELLED' where id = ${fixtures[1]!.orderId}`;
    expect((await orders.readVerifiedPurchaseCount(storeId)).count).toBe(1);

    for (const [owner, rating, moderation] of [
      [storeId, 5, "PUBLISHED"],
      [storeId, 4, "PUBLISHED"],
      [storeId, 1, "HIDDEN"],
      [otherStoreId, 1, "PUBLISHED"],
    ] as const) {
      const id = randomUUID();
      experienceIds.push(id);
      await sql`
        insert into content_purchase_experiences
          (id, buyer_identity_id, order_item_id, store_id, product_id,
           rating, text, moderation_state)
        values (${id}, ${buyerId}, ${randomUUID()}, ${owner}, ${productId},
          ${rating}, 'تجربهٔ آزمون', ${moderation})
      `;
    }
    expect(await content.readPublicStoreRating(storeId)).toBeNull();
    const thirdId = randomUUID();
    experienceIds.push(thirdId);
    await sql`
      insert into content_purchase_experiences
        (id, buyer_identity_id, order_item_id, store_id, product_id,
         rating, text, moderation_state)
      values (${thirdId}, ${buyerId}, ${randomUUID()}, ${storeId}, ${productId},
        4, 'تجربهٔ سوم', 'PUBLISHED')
    `;
    expect(await content.readPublicStoreRating(storeId)).toEqual({
      sampleSize: 3,
      average: 4.3,
    });
    expect(await content.readPublicStoreRating(otherStoreId)).toBeNull();
  } finally {
    await sql`delete from content_purchase_experiences where id in ${sql(experienceIds.length ? experienceIds : [randomUUID()])}`;
    await sql`delete from order_items where order_id = ${fixtures[0]?.orderId ?? randomUUID()}`;
    for (const fixture of fixtures.reverse()) await fixture.cleanup();
    await orders.onModuleDestroy();
    await content.onModuleDestroy();
    await sql.end();
  }
});
