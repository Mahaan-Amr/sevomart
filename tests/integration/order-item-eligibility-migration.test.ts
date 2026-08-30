import { readFile } from "node:fs/promises";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("order item purchase-experience eligibility migration", () => {
  it("backfills existing items and generates stable unique ids for new items", async () => {
    const schema = `order_item_eligibility_${crypto.randomUUID().replaceAll("-", "")}`;
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql.unsafe(`create schema "${schema}"`);
      await sql.unsafe(`set search_path to "${schema}"`);
      await sql.unsafe(`
        create table order_items (
          order_id uuid not null,
          variant_id uuid not null
        )
      `);
      const existingOrderId = crypto.randomUUID();
      await sql`
        insert into order_items (order_id, variant_id)
        values (${existingOrderId}, ${crypto.randomUUID()})
      `;

      await sql.unsafe(await migration());

      const [backfilled] = await sql<Array<{ id: string }>>`
        select id from order_items where order_id = ${existingOrderId}
      `;
      expect(backfilled?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      await sql`
        insert into order_items (order_id, variant_id)
        values (${crypto.randomUUID()}, ${crypto.randomUUID()})
      `;
      const ids = await sql<Array<{ id: string }>>`
        select id from order_items order by order_id
      `;
      expect(new Set(ids.map(({ id }) => id)).size).toBe(2);
      await expect(
        sql`
          insert into order_items (id, order_id, variant_id)
          values (${backfilled!.id}, ${crypto.randomUUID()}, ${crypto.randomUUID()})
        `,
      ).rejects.toMatchObject({ code: "23505" });
      expect(
        await sql<Array<{ id: string }>>`
          select id from order_items where order_id = ${existingOrderId}
        `,
      ).toEqual([backfilled]);
    } finally {
      await sql.unsafe("set search_path to public");
      await sql.unsafe(`drop schema if exists "${schema}" cascade`);
      await sql.end();
    }
  });
});

async function migration() {
  return readFile(
    new URL(
      "../../packages/database/prisma/migrations/20260829131000__orders__purchase-experience-eligibility/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
}
