import { randomUUID } from "node:crypto";

import type { OrderItemId } from "@sevo/contracts/orders/v1";
import type { IdentityId, ProductId, StoreId } from "@sevo/contracts/platform/v1";
import postgres from "postgres";

export async function createPaidOrderItemFixture(
  databaseUrl: string,
  input: {
    buyerId: IdentityId;
    storeId: StoreId;
    productId: ProductId;
    orderItemId: OrderItemId;
  },
) {
  const sql = postgres(databaseUrl, { max: 1 });
  const cartId = randomUUID();
  const checkoutId = randomUUID();
  const orderId = randomUUID();
  await sql`
    insert into order_carts
      (id, store_id, identity_id, status, revision, expires_at)
    values (${cartId}, ${input.storeId}, ${input.buyerId}, 'CONVERTED', 1,
      now() + interval '1 day')
  `;
  await sql`
    insert into order_checkout_preparations
      (checkout_revision, identity_id, cart_id, cart_revision,
       shipping_method_id, shipping_revision, policy_revision, snapshot, expires_at)
    values (${checkoutId}, ${input.buyerId}, ${cartId}, 1,
      ${randomUUID()}, 1, 1, ${sql.json({})}, now() + interval '1 day')
  `;
  await sql`
    insert into order_orders
      (id, identity_id, store_id, checkout_revision, reservation_id, status,
       total_amount, currency, reservation_expires_at, review_snapshot, paid_at)
    values (${orderId}, ${input.buyerId}, ${input.storeId}, ${checkoutId},
      ${randomUUID()}, 'PAID', 1000, 'IRR', now() + interval '1 day',
      ${sql.json({})}, now())
  `;
  await sql`
    insert into order_items
      (id, order_id, variant_id, product_id, name, quantity,
       unit_price_amount, publication_version)
    values (${input.orderItemId}, ${orderId}, ${randomUUID()}, ${input.productId},
      'کالای تأییدشده', 1, 1000, 1)
  `;

  return {
    async cleanup() {
      try {
        await sql`delete from order_items where order_id = ${orderId}`;
        await sql`delete from order_orders where id = ${orderId}`;
        await sql`delete from order_checkout_preparations where checkout_revision = ${checkoutId}`;
        await sql`delete from order_carts where id = ${cartId}`;
      } finally {
        await sql.end();
      }
    },
  };
}
