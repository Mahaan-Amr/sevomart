import { readFile } from "node:fs/promises";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("versioned Store migration", () => {
  it("preserves the existing Store, owner, slug and shipping identity", async () => {
    const schema = `store_migration_${crypto.randomUUID().replaceAll("-", "")}`;
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql.unsafe(`create schema "${schema}"`);
      await sql.unsafe(`set search_path to "${schema}"`);
      await sql.unsafe(await migration("20260816162000__store__create-stores"));
      await sql.unsafe(
        await migration("20260823180100__store__add-publication-version"),
      );

      const storeId = "c47ac10b-58cc-4372-a567-0e02b2c3d479";
      const ownerId = "e47ac10b-58cc-4372-a567-0e02b2c3d479";
      const shippingMethodId = "a47ac10b-58cc-4372-a567-0e02b2c3d479";
      await sql`
        insert into store_stores
          (id, name, slug, bio, return_policy, settlement_kind, settlement_status,
           settlement_verified_at, theme_color, status, published_at)
        values
          (${storeId}, 'خانه قدیمی', 'legacy-store', 'فروشگاه حفظ‌شده',
           'تا هفت روز امکان درخواست مرجوعی وجود دارد.', 'TEST', 'TEST_VERIFIED',
           now(), '#A41439', 'PUBLISHED', now())
      `;
      await sql`
        insert into store_memberships (id, store_id, seller_id, role)
        values (${crypto.randomUUID()}, ${storeId}, ${ownerId}, 'OWNER')
      `;
      await sql`
        insert into store_shipping_methods (id, store_id, position, code, label)
        values (${shippingMethodId}, ${storeId}, 0, 'NATIONAL_POST', 'پست پیشتاز')
      `;

      await sql.unsafe(await migration("20260824093000__store__versioned-contract"));

      const stores = await sql<
        Array<{
          id: string;
          slug: string;
          revision: number;
          returnPolicyRevision: number;
        }>
      >`
        select id, slug, revision,
          return_policy_revision as "returnPolicyRevision"
        from store_stores
      `;
      const shipping = await sql<
        Array<{
          id: string;
          revision: number;
          requiresDeliveryAddress: boolean;
          requiresPostalCode: boolean;
        }>
      >`
        select id, revision,
          requires_delivery_address as "requiresDeliveryAddress",
          requires_postal_code as "requiresPostalCode"
        from store_shipping_methods
      `;
      const memberships = await sql<Array<{ sellerId: string }>>`
        select seller_id as "sellerId" from store_memberships
      `;

      expect(stores).toEqual([
        { id: storeId, slug: "legacy-store", revision: 1, returnPolicyRevision: 1 },
      ]);
      expect(shipping).toEqual([
        {
          id: shippingMethodId,
          revision: 1,
          requiresDeliveryAddress: true,
          requiresPostalCode: true,
        },
      ]);
      expect(memberships).toEqual([{ sellerId: ownerId }]);
    } finally {
      await sql.unsafe(`drop schema if exists "${schema}" cascade`);
      await sql.end();
    }
  });
});

async function migration(directory: string) {
  return readFile(
    new URL(
      `../../packages/database/prisma/migrations/${directory}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  );
}
