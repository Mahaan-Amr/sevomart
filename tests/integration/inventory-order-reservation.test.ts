import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PostgresInventoryAuthoring } from "../../apps/api/src/modules/inventory/composition";
import {
  InventoryReservationUnavailableError,
  type InventoryTransactionContext,
} from "../../apps/api/src/modules/inventory/public";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const variantId = "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7";
const storeId = "ad75d73c-1744-422c-a6ae-31195ed6abf1";

describe("inventory reservation transaction seam", () => {
  const clients: ReturnType<typeof postgres>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    clients.push(sql);
    await sql`delete from inventory_reservation_lines`;
    await sql`delete from inventory_reservations`;
    await sql`delete from inventory_levels where variant_id = ${variantId}`;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${variantId}, ${storeId}, 1, 1)
    `;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.end()));
  });

  it("allows only one concurrent order to reserve the final sellable unit", async () => {
    const inventory = new PostgresInventoryAuthoring(apiTestEnvironment.DATABASE_URL);
    const reserve = async (orderId: string, reservationId: string) => {
      const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
      clients.push(sql);
      return sql.begin((transaction) =>
        inventory.reserveForOrder(
          transaction as unknown as InventoryTransactionContext,
          {
            orderId,
            reservationId,
            storeId: storeId as never,
            expiresAt: new Date(Date.now() + 15 * 60_000),
            items: [{ variantId: variantId as never, quantity: 1 }],
          },
        ),
      );
    };

    const results = await Promise.allSettled([
      reserve(
        "47a3f408-858c-45d7-a0bd-ab84a28718ef",
        "6070faec-78f8-4a5f-86da-cdd19b39c5a3",
      ),
      reserve(
        "1b44a29f-59ba-47f8-9079-c1d338145e12",
        "077c8973-91a6-48e1-9707-a0472ea65ab6",
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(InventoryReservationUnavailableError),
    });
    expect(await inventory.read(variantId as never)).toMatchObject({
      onHand: 1,
      reserved: 1,
      available: 0,
    });
    await inventory.onModuleDestroy();
  });

  it("makes an expired unpaid reservation sellable without reducing on-hand", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    clients.push(sql);
    await sql`
      insert into inventory_reservations (id, order_id, store_id, status, expires_at)
      values
        ('6070faec-78f8-4a5f-86da-cdd19b39c5a3',
         '47a3f408-858c-45d7-a0bd-ab84a28718ef', ${storeId}, 'ACTIVE',
         now() - interval '1 second')
    `;
    await sql`
      insert into inventory_reservation_lines (reservation_id, variant_id, quantity)
      values ('6070faec-78f8-4a5f-86da-cdd19b39c5a3', ${variantId}, 1)
    `;
    const inventory = new PostgresInventoryAuthoring(apiTestEnvironment.DATABASE_URL);

    expect(await inventory.read(variantId as never)).toMatchObject({
      onHand: 1,
      reserved: 0,
      available: 1,
    });
    await inventory.onModuleDestroy();
  });
});
