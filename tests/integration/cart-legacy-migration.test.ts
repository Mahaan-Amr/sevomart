import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { expect, it } from "vitest";
import { apiTestEnvironment } from "../helpers/api-test-environment";

it("preserves an existing single-store cart through the multi-store migrations", async () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const schema = `cart_migration_${randomUUID().replaceAll("-", "")}`;
  const cartId = randomUUID();
  const storeId = randomUUID();
  const variantId = randomUUID();
  const hash = "a".repeat(64);
  try {
    await sql.unsafe(`create schema ${schema}`);
    await sql.unsafe(`set search_path to ${schema}`);
    await sql.unsafe(
      `create table order_carts (id uuid primary key, store_id uuid not null, reviewed_policy_revision integer not null, reviewed_shipping_hash char(64) not null)`,
    );
    await sql.unsafe(
      `create table order_cart_items (cart_id uuid not null references order_carts(id), variant_id uuid not null, quantity integer not null, primary key (cart_id, variant_id))`,
    );
    await sql`insert into order_carts values (${cartId}, ${storeId}, 7, ${hash})`;
    await sql`insert into order_cart_items values (${cartId}, ${variantId}, 3)`;
    for (const migration of [
      "20260927140000__orders__cart-item-store",
      "20260927150000__orders__cart-item-review",
    ]) {
      await sql.unsafe(
        readFileSync(
          `packages/database/prisma/migrations/${migration}/migration.sql`,
          "utf8",
        ),
      );
    }
    const rows =
      await sql`select cart_id, store_id, variant_id, quantity, reviewed_policy_revision, reviewed_shipping_hash from order_cart_items`;
    expect(rows).toEqual([
      {
        cart_id: cartId,
        store_id: storeId,
        variant_id: variantId,
        quantity: 3,
        reviewed_policy_revision: 7,
        reviewed_shipping_hash: hash,
      },
    ]);
  } finally {
    await sql.unsafe(`drop schema if exists ${schema} cascade`);
    await sql.end();
  }
});
