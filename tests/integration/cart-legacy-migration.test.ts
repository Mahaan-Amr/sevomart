import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { expect, it } from "vitest";
import { apiTestEnvironment } from "../helpers/api-test-environment";

it("preserves multiple legacy carts and their items through the multi-store migrations", async () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const schema = `cart_migration_${randomUUID().replaceAll("-", "")}`;
  const carts = [
    {
      id: randomUUID(),
      store: randomUUID(),
      revision: 7,
      hash: "a".repeat(64),
      status: "ACTIVE",
    },
    {
      id: randomUUID(),
      store: randomUUID(),
      revision: 2,
      hash: "b".repeat(64),
      status: "MERGED",
    },
    { id: randomUUID(), store: randomUUID(), revision: 0, hash: "", status: "ACTIVE" },
  ];
  const items = [
    { cart: 0, variant: randomUUID(), product: randomUUID(), quantity: 3, price: 1200 },
    { cart: 0, variant: randomUUID(), product: randomUUID(), quantity: 1, price: 2000 },
    { cart: 1, variant: randomUUID(), product: randomUUID(), quantity: 5, price: 3000 },
    { cart: 2, variant: randomUUID(), product: randomUUID(), quantity: 99, price: 0 },
  ];
  async function migrate(name: string) {
    await sql.unsafe(
      readFileSync(`packages/database/prisma/migrations/${name}/migration.sql`, "utf8"),
    );
  }
  try {
    await sql.unsafe(`create schema ${schema}`);
    await sql.unsafe(`set search_path to ${schema}`);
    // Execute the historical cart DDL, including indexes, checks, and foreign keys.
    await migrate("20260824143000__orders__guest-cart-login");
    await migrate("20260824153000__orders__cart-review-saved-addresses");
    await migrate("20260824200100__orders__checkout-orders");
    for (const cart of carts) {
      await sql`insert into order_carts (id, store_id, status, expires_at, reviewed_policy_revision, reviewed_shipping_hash)
        values (${cart.id}, ${cart.store}, ${cart.status}, now() + interval '1 day', ${cart.revision}, ${cart.hash})`;
    }
    for (const item of items) {
      await sql`insert into order_cart_items (cart_id, variant_id, product_id, quantity, reviewed_publication_version, reviewed_unit_price_amount)
        values (${carts[item.cart]!.id}, ${item.variant}, ${item.product}, ${item.quantity}, 4, ${item.price})`;
    }
    await migrate("20260927140000__orders__cart-item-store");
    await migrate("20260927150000__orders__cart-item-review");
    const rows =
      await sql`select cart_id, store_id, variant_id, product_id, quantity, reviewed_policy_revision, rtrim(reviewed_shipping_hash) as reviewed_shipping_hash, reviewed_publication_version, reviewed_unit_price_amount from order_cart_items`;
    expect(rows).toHaveLength(items.length);
    for (const item of items) {
      const cart = carts[item.cart]!;
      expect(rows.find((row) => row.variant_id === item.variant)).toMatchObject({
        cart_id: cart.id,
        store_id: cart.store,
        product_id: item.product,
        quantity: item.quantity,
        reviewed_policy_revision: cart.revision,
        reviewed_shipping_hash: cart.hash,
        reviewed_publication_version: 4,
        reviewed_unit_price_amount: item.price,
      });
    }
    const storedCarts =
      await sql`select id, status, store_id, reviewed_policy_revision, rtrim(reviewed_shipping_hash) as reviewed_shipping_hash from order_carts`;
    expect(storedCarts).toHaveLength(carts.length);
    for (const cart of carts) {
      expect(storedCarts.find((row) => row.id === cart.id)).toMatchObject({
        status: cart.status,
        store_id: cart.store,
        reviewed_policy_revision: cart.revision,
        reviewed_shipping_hash: cart.hash,
      });
    }
  } finally {
    await sql.unsafe(`drop schema if exists ${schema} cascade`);
    await sql.end();
  }
});
